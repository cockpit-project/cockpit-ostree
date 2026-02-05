/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2016 Red Hat, Inc.
 */

import cockpit from 'cockpit';

import client from './client.js';
import { parseData, changeData } from './utils.js';

const _ = cockpit.gettext;

export function listRemotes() {
    return cockpit.spawn(["ostree", "remote", "list"],
                         { superuser: "try", err: "message" })
            .then(output => {
                const d = [];
                output.trim().split(/\r\n|\r|\n/)
                        .forEach(v => { if (v) d.push(v); });
                return d.sort();
            });
}

export function listBranches(remote) {
    return client.reload().then(function () {
        return cockpit.spawn(["ostree", "remote", "refs", remote],
                             { superuser: "try", err: "message" })
                .then(output => {
                    const d = [];
                    output.trim().split(/\r\n|\r|\n/)
                            .forEach(v => {
                                const parts = v.split(":");
                                if (parts.length > 1)
                                    d.push(parts.slice(1).join(":"));
                                else if (v)
                                    d.push(v);
                            });
                    return d.sort();
                });
    });
}

export function addRemote(name, url, gpg) {
    const cmd = ["ostree", "remote", "add"];
    if (gpg)
        cmd.push("--set=gpg-verify=true");
    else
        cmd.push("--set=gpg-verify=false");
    cmd.push(name, url);

    return cockpit.spawn(cmd, { superuser: "try", err: "message" });
}

export function deleteRemote(name) {
    return cockpit.spawn(["ostree", "remote", "delete", name],
                         { superuser: "try", err: "message" });
}

export function importGPGKey(name, key) {
    const process = cockpit.spawn(["ostree", "remote", "gpg-import", "--stdin", name],
                                  { superuser: "try", err: "message" });
    process.input(key);
    return process;
}

function getRemoteSettingsFile(name) {
    return cockpit.file("/etc/ostree/remotes.d/" + name + ".conf",
                        { superuser: "try" });
}

function getSectionName(name) {
    return 'remote "' + name + '"';
}

export function loadRemoteSettings(name) {
    const file = getRemoteSettingsFile(name);
    const section = getSectionName(name);
    return new Promise((resolve, reject) => {
        file.read()
                .then(content => {
                    const data = parseData(content);
                    if (data[section])
                        resolve(data[section]);
                    else
                        reject(_("No configuration data found"));
                })
                .catch(reject)
                .finally(file.close);
    });
}

export function updateRemoteSettings(name, options) {
    const file = getRemoteSettingsFile(name);
    const section = getSectionName(name);

    const promise = file.modify(content => changeData(content, section, options));
    promise.finally(file.close);
    return promise;
}
