import cockpit from 'cockpit';

import { logDebug } from './utils.js';
const _ = cockpit.gettext;

const DEST = 'org.projectatomic.rpmostree1';
const PATH = '/org/projectatomic/rpmostree1';

const SYSROOT = 'org.projectatomic.rpmostree1.Sysroot';
const SYSROOT_PATH = '/org/projectatomic/rpmostree1/Sysroot';

const OS = 'org.projectatomic.rpmostree1.OS';
const TRANSACTION = 'org.projectatomic.rpmostree1.Transaction';

/*
 * Breaks down progress messages into
 * a string that can be displayed
 * Similar to the cli output but simpler.
 * We don't display object counts or bytes/s.
 * Percentages are only possible when
 * we actually know what is going to be pulled.
 *
 * progress_arg is a tuple of 6 tuples
 * with the following values:
 *
 * time data (tt): (start time, elapsed seconds)
 * outstanding data counts (uu): (outstanding fetches,
 *                                 outstanding writes)
 * metadata counts (uuu): (scanned, fetched, outstanding)
 * delta data (uuut): (total parts, fetched parts,
 *                     total super blocks, total size)
 * content objects (uu): (fetched objects, requested objects)
 * transfer data (tt): (bytes transferred, bytes/s)
 */

function build_progress_line(progress_arg) {
    if (!progress_arg || progress_arg.length !== 6 ||
        progress_arg[0].length !== 2 || progress_arg[1].length !== 2 ||
        progress_arg[2].length !== 3 || progress_arg[3].length !== 4 ||
        progress_arg[4].length !== 2 || progress_arg[5].length !== 2) {
        console.warn("Unknown progress data", progress_arg);
        return;
    }

    let line;
    const outstanding_fetches = progress_arg[1][0];
    const outstanding_writes = progress_arg[1][0];

    const outstanding_metadata_fetches = progress_arg[2][2];

    const total_delta_parts = progress_arg[3][0];

    const fetched = progress_arg[4][0];
    const requested = progress_arg[4][1];

    if (outstanding_fetches) {
        if (total_delta_parts > 0) {
            line = _("Receiving delta parts");
        } else if (outstanding_metadata_fetches) {
            line = _("Receiving metadata objects");
        } else {
            const percent = (fetched / requested) * 100;
            line = cockpit.format(_("Receiving objects: $0%"), percent.toFixed(2));
        }
    } else if (outstanding_writes) {
        line = _("Writing objects");
    } else {
        line = _("Scanning metadata");
    }
    return line;
}

function process_diff_list(result) {
    const key_names = ["adds", "removes", "up", "down"];
    const list = result[0];
    const diffs = {};
    for (let i = 0; i < list.length; i++) {
        const key = key_names[list[i][1]];

        if (!diffs[key])
            diffs[key] = [];

        const obj = {
            name: list[i][0],
            type: list[i][1],
        };

        if (obj.type === 1) {
            obj.version = list[i][2].PreviousPackage.v[1];
            obj.arch = list[i][2].PreviousPackage.v[2];
        } else {
            obj.version = list[i][2].NewPackage.v[1];
            obj.arch = list[i][2].NewPackage.v[2];
        }

        diffs[key].push(obj);
    }
    return diffs;
}

function process_rpm_list(result) {
    const data = [];
    result.split("\n").forEach(v => {
        if (v) {
            data.push({
                name: v,
            });
        }
    });
    data.sort((a, b) => {
        const n1 = a.name || "";
        const n2 = b.name || "";
        return n1.toLowerCase().localeCompare(n2.toLowerCase());
    });

    if (data.length < 1)
        return;

    let half = Math.floor(data.length / 2);
    if (data.length % 2)
        half = half + 1;

    return {
        'rpms-col1': data.slice(0, half + 1),
        'rpms-col2': data.slice(half + 1),
    };
}

function Packages(promise, transform) {
    this.error = null;
    this.ready = false;
    this.empty = false;

    cockpit.event_target(this);

    promise
            .then(result => {
                let empty = true;
                if (transform)
                    result = transform(result);

                for (const k in result) {
                    this[k] = result[k];
                    empty = false;
                }

                this.empty = empty;
                this.valid = true;
            })
            .catch(ex => {
                this.error = cockpit.message(ex);
            })
            .finally(() => {
                this.ready = true;
                this.dispatchEvent("changed");
            });
}

class RPMOSTreeDBusClient {
    constructor() {
        cockpit.event_target(this);

        this.connection_error = null;
        this.os_list = [];

        this.sysroot = null;
        this.os_proxies = {};
        this.os_proxies_added = null;

        this.os_names = {};
        this.packages_cache = {};
        this.update_cache = {};

        this.local_running = null;
        this.booted_id = null;

        this.client = null;
        this.waits = null;
        this.timer = null;
        this.skipped = false;

        this.on_sysroot_changed = this.on_sysroot_changed.bind(this);
    }

    trigger_changed() {
        if (!this.timer) {
            this.dispatchEvent("changed");
            this.timer = window.setTimeout(() => {
                this.timer = null;
                if (this.skipped)
                    this.dispatchEvent("changed");
                this.skipped = false;
            }, 300);
        } else {
            this.skipped = true;
        }
    }

    get_client() {
        if (!this.client) {
            this.connection_error = null;
            this.os_list = [];

            this.sysroot = null;
            this.os_proxies = {};
            this.os_proxies_added = null;

            this.os_names = {};
            this.packages_cache = {};
            this.update_cache = {};

            this.local_running = null;
            this.booted_id = null;

            this.waits_resolve = null;
            this.waits = new Promise(resolve => { this.waits_resolve = resolve });
            this.waits.then(() => {
                if (this.sysroot && this.sysroot.valid)
                    this.build_os_list(this.sysroot.Deployments);
                else
                    this.trigger_changed();
            });

            this.client = cockpit.dbus(DEST, { superuser: true, capabilities: ["address"] });

            /* Watch before listening for close because watch fires first */
            this.client.watch(PATH).fail(this.tear_down);
            this.client.addEventListener("close", (event, ex) => {
                this.tear_down(ex);
                this.dispatchEvent("connectionLost", [ex]);
            });

            this.sysroot = this.client.proxy(SYSROOT, SYSROOT_PATH);
            this.sysroot.addEventListener("changed", this.on_sysroot_changed);
            this.sysroot.wait(() => {
                if (this.client) {
                    this.os_proxies = this.client.proxies(OS, PATH);
                    this.os_proxies_added = (event, proxy) => {
                        if (proxy.Name)
                            this.os_names[proxy.Name] = proxy.path;
                    };
                    this.os_proxies.addEventListener("changed", this.trigger_changed.bind(this));
                    this.os_proxies_added = this.os_proxies_added.bind(this);
                    this.os_proxies.addEventListener("added", this.os_proxies_added);

                    this.os_proxies.wait(() => {
                        let path;
                        for (path in this.os_proxies) {
                            const proxy = this.os_proxies[path];
                            this.os_names[proxy.Name] = path;
                        }
                        this.waits_resolve();
                    });
                } else {
                    this.waits_resolve();
                }
            });
        }
        return this.client;
    }

    tear_down(ex) {
        this.client = null;
        this.connection_error = ex;
        if (this.sysroot) {
            this.sysroot.removeEventListener("changed", this.on_sysroot_changed);
            this.sysroot = null;
        }
        if (this.os_proxies) {
            if (this.os_proxies_added)
                this.os_proxies.removeEventListener("added", this.os_proxies_added);
            this.os_proxies_added = null;
            this.os_proxies = {};
        }
    }

    // The order of deployments indicates the order the OS names should be in
    build_os_list(data) {
        const seen = {};
        const os_list = [];

        if (data) {
            for (let i = 0; i < data.length; i++) {
                const deployment = data[i];
                const os = deployment.osname.v;

                if (!seen[os])
                    os_list.push(os);
                seen[os] = true;
            }
        }

        this.os_list = os_list;
        this.trigger_changed();
    }

    on_sysroot_changed(ev, data) {
        if (data.Deployments) {
            this.build_os_list(data.Deployments);
        } else if ("ActiveTransaction" in data) {
            this.trigger_changed();
        }
    }

    get_os_origin (os) {
        let origin;
        let proxy = this.get_os_proxy(os);

        if (!proxy && this.sysroot)
            proxy = this.os_proxies[this.sysroot.Booted];

        const deployment_origin = deployment => deployment?.origin?.v || deployment?.["container-image-reference"]?.v;

        if (proxy) {
            origin = deployment_origin(proxy.BootedDeployment);
            if (origin) {
                logDebug("get_os_origin", os, "from BootedDeployment", origin);
            } else {
                origin = deployment_origin(proxy.DefaultDeployment);
                logDebug("get_os_origin", os, "from DefaultDeployment", origin);
            }
        } else {
            logDebug("get_os_origin", os, "no proxy");
        }

        return origin;
    }

    build_change_refspec(os, remote, branch) {
        const current_origin = this.get_default_origin(os);

        if (!remote && current_origin)
            remote = current_origin.remote;

        if (!branch && current_origin)
            branch = current_origin.branch;

        if (current_origin && current_origin.branch === branch && current_origin.remote === remote)
            return;

        if (!remote || !branch)
            return;

        return remote + ":" + branch;
    }

    connect() {
        this.get_client();
        return this.waits.then(() =>
            this.connection_error ? Promise.reject(this.connection_error) : this.client
        );
    }

    known_versions_for(os_name, remote, branch) {
        /* The number of deployments should always be a small
         * number. If that turns out to not be the case we
         * can cache this on a local property.
         */
        const deployments = this.sysroot ? this.sysroot.Deployments : [];
        const list = [];
        let cached_origin;
        const alt_refspec = this.build_change_refspec(os_name, remote, branch);

        const proxy = this.get_os_proxy(os_name);
        if (proxy) {
            cached_origin = proxy.CachedUpdate?.origin?.v;
            if (cached_origin)
                this.update_cache[cached_origin] = proxy.CachedUpdate;
        }

        const update = this.update_cache[alt_refspec || cached_origin];

        const upgrade_checksum = update?.checksum?.v;

        for (let i = 0; i < deployments.length; i++) {
            const deployment = deployments[i];
            const checksum = deployment.checksum?.v;

            if (deployment.id && deployment.osname?.v !== os_name)
                continue;

            // treat container-image-reference as origin
            if (!deployment.origin && deployment["container-image-reference"])
                deployment.origin = deployment["container-image-reference"];

            // required for pinning deployments
            deployment.index = i;

            // always show the default deployment,
            // skip showing the upgrade if it is the
            // same as the default.
            if (this.item_matches(deployment, "DefaultDeployment")) {
                if (upgrade_checksum && checksum !== upgrade_checksum)
                    list.push(update);
                list.push(deployment);

            // skip other deployments if it is the same as the upgrade
            } else if (deployment.checksum?.v !== upgrade_checksum) {
                list.push(deployment);
            }
        }

        logDebug(`known_versions_for osname '${os_name}' remote '${remote}' branch '${branch}':`, list);
        return list;
    }

    get_default_origin(os) {
        let origin = this.get_os_origin(os);

        // OStree repos look like "local:fedora/x86_64/coreos/testing"
        // OCI repos like 'ostree-unverified-registry:quay.io/fedora/fedora-coreos:stable'
        if (origin) {
            const parts = origin.split(':');
            if (parts.length > 1)
                origin = { remote: parts.slice(0, -1).join(':'), branch: parts[parts.length - 1] };
            else
                origin = { remote: origin };
        }

        return origin;
    }

    get_os_proxy(os_name) {
        const path = this.os_names[os_name];
        let proxy = null;
        if (path)
            proxy = this.os_proxies[path];
        return proxy;
    }

    /* This is a little fragile because the
     * the dbus variant is simply 'av'.
     * Ostree promises to not remove or change the
     * order of any of these attributes.
     *  https://github.com/ostreedev/ostree/commit/4a2733f9e7e2ca127ff27433c045c977000ca346#diff-c38f32cb7112030f3326b43e305f2accR424
     * Here's the definition this relies on
     * - bool valid
     * - bool is sig expired
     * - bool is key expired
     * - bool is key revoked
     * - bool is key missing
     * - str key fingerprint
     * - int signature timestamp
     * - int signature expiry timestamp
     * - str key algo name
     * - str key hash algo name
     * - str key user name
     * - str key user email
     */
    signature_obj(signature) {
        if (!signature.v)
            return;

        let by = signature.v[11];
        if (signature.v[10])
            by = by ? cockpit.format("$0 <$1>", signature.v[10], by) : signature.v[10];

        return {
            fp: signature.v[5],
            fp_name: signature.v[8] ? cockpit.format(_("$0 key ID"), signature.v[8]) : null,
            expired: signature.v[1] || signature.v[2],
            valid: signature.v[0],
            timestamp: signature.v[6],
            by
        };
    }

    /* Because all our deployment package diffs can only
     * change when the machine is rebooted we
     * fetch and store them once here and
     * never fetch them again.
     * Pending updates are tracked by checksum since those
     * can change.
     */
    packages(item) {
        const id = item.id?.v;
        const checksum = item.checksum?.v;
        const key = id || checksum;

        if (!this.booted_id) {
            const root_proxy = this.os_proxies[this.sysroot.Booted];
            if (root_proxy)
                this.booted_id = root_proxy.BootedDeployment.id.v;
            else
                return;
        }

        if (key && !this.packages_cache[key]) {
            const proxy = this.get_os_proxy(item.osname.v);
            let packages;
            let promise;
            if (proxy) {
                if (id === this.booted_id) {
                    promise = cockpit.spawn(['rpm', '-qa']);
                    packages = new Packages(promise,
                                            process_rpm_list);
                } else if (id) {
                    promise = proxy.call("GetDeploymentsRpmDiff",
                                         [this.booted_id, id]);
                    packages = new Packages(promise,
                                            process_diff_list);
                } else if (item.origin.v === this.get_os_origin(proxy.Name)) {
                    promise = proxy.call("GetCachedUpdateRpmDiff", [""]);
                    packages = new Packages(promise,
                                            process_diff_list);
                }
                this.packages_cache[key] = packages;
            }
        }
        return this.packages_cache[key];
    }

    item_matches(item, proxy_attr, attr) {
        const os_name = item?.osname?.v;
        let proxy = null;
        let item2 = null;

        if (!os_name)
            return false;

        proxy = this.get_os_proxy(os_name);
        item2 = proxy[proxy_attr];

        if (!attr)
            attr = "checksum";
        return item?.[attr]?.v === item2?.[attr]?.v;
    }

    cache_update_for(os, remote, branch) {
        const refspec = this.build_change_refspec(os, remote, branch);
        const proxy = this.get_os_proxy(os);

        if (proxy) {
            if (!refspec)
                return Promise.resolve(proxy.CachedUpdate);

            return proxy.call("GetCachedRebaseRpmDiff", [refspec, []])
                    .then(data => {
                        let item;
                        if (data && data.length === 2 && data[1].checksum?.v) {
                            item = data[1];
                            this.update_cache[refspec] = item;
                            this.packages_cache[item.checksum.v] = new Packages(Promise.resolve([data[0]]),
                                                                                process_diff_list);
                        }

                        if (item)
                            return item;
                        else
                            return Promise.reject(new Error({ problem: "protocol-error" }));
                    });
        } else {
            return Promise.reject(new Error(cockpit.format(_("OS $0 not found"), os)));
        }
    }

    check_for_updates(os, remote, branch) {
        let promise;
        const refspec = this.build_change_refspec(os, remote, branch);
        if (refspec) {
            promise = this.run_transaction("DownloadRebaseRpmDiff", [refspec, []], os)
                    .then(() => {
                        // Need to get and store the cached data.
                        // Make it like this is part of the download
                        // call.
                        this.local_running = "DownloadRebaseRpmDiff:" + os;
                        return this.cache_update_for(os, remote, branch)
                                .finally(() => {
                                    this.local_running = null;
                                    this.trigger_changed();
                                });
                    });
        } else {
            promise = this.run_transaction("DownloadUpdateRpmDiff", null, os);
        }
        return promise;
    }

    reload() {
        return new Promise((resolve, reject) => {
            // Not all Systems support this so just skip if not known
            if (this.sysroot && this.sysroot.ReloadConfig) {
                this.sysroot.ReloadConfig()
                        .catch(ex => console.warn("Error reloading config:", ex))
                        .finally(() => resolve());
            } else {
                resolve();
            }
        });
    }

    run_transaction(method, method_args, os) {
        this.local_running = method + ":" + os;
        let transaction_client = null;
        let subscription = null;
        const dp = cockpit.defer();
        let i;
        let reboot = false;

        logDebug("run_transaction", method, method_args, os, ": start");

        if (Array.isArray(method_args)) {
            for (i = 0; i < method_args.length; i++) {
                const val = method_args[i];
                if (val !== null && typeof val === 'object' && "reboot" in val) {
                    reboot = method_args[i].reboot;
                    break;
                }
            }
        }

        const cleanup = () => {
            this.local_running = null;
            if (transaction_client) {
                if (subscription)
                    subscription.remove();

                transaction_client.removeEventListener("close", on_close);
                transaction_client.close();
            }
            transaction_client = null;
            subscription = null;
            this.trigger_changed();
        };

        const fail = ex => {
            dp.reject(ex);
            cleanup();
        };

        const on_close = (event, ex) => {
            logDebug("run_transaction", method, method_args, os, ": closed", ex);
            fail(ex);
        };

        this.connect()
                .then(() => {
                    const proxy = this.get_os_proxy(os);

                    if (!proxy)
                        return fail(cockpit.format(_("OS $0 not found"), os));

                    this.reload().then(() => {
                        proxy.call(method, method_args)
                                .then(result => {
                                    const connect_args = {
                                        superuser: true,
                                        address: result[0],
                                        bus: "none"
                                    };

                                    if (reboot)
                                        cockpit.hint('restart');

                                    transaction_client = cockpit.dbus(null, connect_args);
                                    transaction_client.addEventListener("close", on_close);

                                    subscription = transaction_client.subscribe(
                                        { path: "/", },
                                        (path, iface, signal, args) => {
                                            if (signal === "DownloadProgress") {
                                                logDebug("run_transaction", method, method_args, os, ": got DownloadProgress", args);
                                                const line = build_progress_line(args);
                                                if (line)
                                                    dp.notify(line);
                                            } else if (signal === "Message") {
                                                logDebug("run_transaction", method, method_args, os, ": got Message", args[0]);
                                                dp.notify(args[0]);
                                            } else if (signal === "Finished") {
                                                logDebug("run_transaction", method, method_args, os, ": got Finished", args);
                                                if (args) {
                                                    if (args[0]) {
                                                        dp.resolve(args[1]);
                                                        cleanup();
                                                    } else {
                                                        fail(args[1]);
                                                    }
                                                } else {
                                                    console.warn("Unexpected transaction response", args);
                                                    fail({ problem: "protocol-error" });
                                                }
                                            }
                                        });
                                    transaction_client.call("/", TRANSACTION, "Start");
                                })
                                .catch(fail);
                    });
                })
                .catch(fail);

        return dp.promise();
    }
}

/* singleton client instance */
const client = new RPMOSTreeDBusClient();
export default client;
