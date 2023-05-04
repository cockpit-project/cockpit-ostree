/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import 'cockpit-dark-theme'; // once per page

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from "prop-types";
import { debounce } from 'throttle-debounce';

import 'patternfly/patternfly-5-cockpit.scss';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card";
import { EmptyState, EmptyStateIcon, EmptyStateBody, EmptyStateHeader, EmptyStateFooter, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState";
import {
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription
} from "@patternfly/react-core/dist/esm/components/DescriptionList";
import { Label } from "@patternfly/react-core/dist/esm/components/Label";
import {
    OverflowMenu, OverflowMenuContent, OverflowMenuGroup, OverflowMenuItem, OverflowMenuControl, OverflowMenuDropdownItem
} from "@patternfly/react-core/dist/esm/components/OverflowMenu";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner";
import { Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar";

import { Select, SelectOption } from "@patternfly/react-core/dist/esm/deprecated/components/Select";
import { Dropdown, KebabToggle } from "@patternfly/react-core/dist/esm/deprecated/components/Dropdown";

import { ExclamationCircleIcon, PendingIcon, ErrorCircleOIcon } from '@patternfly/react-icons';

import cockpit from 'cockpit';

import * as timeformat from 'timeformat';
import { superuser } from 'superuser';
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';

import client from './client';
import * as remotes from './remotes';
import { ChangeRemoteModal } from './changeRemoteModal.jsx';

import './ostree.scss';

const _ = cockpit.gettext;

superuser.reload_page_on_change();

function track_id(item) {
    if (!item)
        return;

    let key = item.osname.v;
    if (item.id)
        key = key + item.id.v;

    if (item.checksum)
        key = key + item.checksum.v;

    return key;
}

function format_version(deployment) {
    let formatted = "";
    if (!deployment || !deployment.osname)
        return;

    if (deployment.version)
        formatted = deployment.version.v;

    return cockpit.format("$0 $1", deployment.osname.v, formatted);
}

// https://github.com/cockpit-project/cockpit/blob/main/pkg/lib/notifications.js
function set_page_status(status) {
    cockpit.transport.control("notify", { page_status: status });
}

/* client.changed often happens several times at the start, avoid flickering */
const set_update_status = debounce(1000, versions => {
    if (versions && versions.length > 0) {
        /* if the latest version is booted, we are current */
        if (versions[0].booted && versions[0].booted.v) {
            set_page_status({
                title: _("System is up to date"),
                details: { pficon: "check" }
            });
        } else {
            /* report the available update */
            set_page_status({
                title: cockpit.format(_("Update available: $0"), format_version(versions[0])),
                type: "warning",
            });
        }
    } else {
        console.warn("got invalid client.known_versions_for() result:", JSON.stringify(versions));
        set_page_status(null);
    }
});

/**
 * Empty state for connecting and errors
 */
const Curtain = ({ state, failure, message, reconnect }) => {
    if (state === 'silent')
        return null;

    let icon = null;
    if (state === 'connecting')
        icon = <Spinner size="xl" />;
    else if (failure)
        icon = <EmptyStateIcon icon={ExclamationCircleIcon} />;

    let title;
    if (state === 'connecting')
        title = _("Connecting to OSTree");
    else if (state === 'failed')
        title = _("Unable to communicate with OSTree");
    else if (state === 'empty')
        title = _("No deployments");

    return (
        <EmptyState variant={EmptyStateVariant.full}>
            {icon}
            <EmptyStateHeader titleText={title} headingLevel="h5" />
            { message && <EmptyStateBody>{message}</EmptyStateBody> }
            <EmptyStateFooter>
                { (state === 'failed' && reconnect) && <Button variant="primary">{ _("Reconnect") }</Button> }
            </EmptyStateFooter>
        </EmptyState>
    );
};

Curtain.propTypes = {
    state: PropTypes.string.isRequired,
    failure: PropTypes.bool.isRequired,
    message: PropTypes.string,
    reconnect: PropTypes.bool,
};

const OriginSelector = ({ os, remotes, branches, branchLoadError, currentRemote, currentBranch, setChangeRemoteModal, onChangeBranch }) => {
    const [branchSelectExpanded, setBranchSelectExpanded] = useState(false);

    if (!os)
        return null;

    const origin = client.get_default_origin(os);

    if (!origin || !remotes || remotes.length === 0)
        return <Alert variant="default" isInline title={ _("No configured remotes") } />;

    return (
        <>
            <Toolbar id="repo-remote-toolbar" className="pf-m-page-insets">
                <ToolbarContent>
                    <ToolbarItem variant="label">{ _("Repository") }</ToolbarItem>
                    <ToolbarItem><Button id="change-repo" variant="link" isInline onClick={() => setChangeRemoteModal(true)}>{currentRemote}</Button></ToolbarItem>

                    <ToolbarItem variant="label" id="branch-select-label">{ _("Branch") }</ToolbarItem>
                    <ToolbarItem>
                        <Select aria-label={ _("Select branch") } aria-labelledby="branch-select-label"
                                toggleId="change-branch"
                                isOpen={branchSelectExpanded}
                                selections={currentBranch}
                                onToggle={(_event, exp) => setBranchSelectExpanded(exp) }
                                onSelect={(_event, branch) => { setBranchSelectExpanded(false); onChangeBranch(branch) } }>
                            { branchLoadError
                                ? [<SelectOption key="_error" isDisabled value={branchLoadError} />]
                                : (branches || []).map(branch => <SelectOption key={branch} value={branch} />)
                            }
                        </Select>
                    </ToolbarItem>
                </ToolbarContent>
            </Toolbar>
            {branchLoadError && <Alert variant="warning" isInline title={branchLoadError} />}
        </>
    );
};

OriginSelector.propTypes = {
    os: PropTypes.string,
    remotes: PropTypes.arrayOf(PropTypes.string),
    branches: PropTypes.arrayOf(PropTypes.string),
    branchLoadError: PropTypes.string,
    currentRemote: PropTypes.string,
    currentBranch: PropTypes.string,
    setChangeRemoteModal: PropTypes.func.isRequired,
    onChangeBranch: PropTypes.func.isRequired,
};

/**
 * Render a single deployment in the table
 */

const Packages = ({ packages }) => {
    if (!packages)
        return null;

    if (packages.empty)
        return <p className="same-packages">{ _("This deployment contains the same packages as your currently booted system") }</p>;

    const res = [];

    const render_list = (type, title) => {
        if (packages[type]) {
            /* rpms{1,2} have version/arch in name, and the version/arch fields are undefined */
            const f = packages[type].map(p => <dd key={ p.name } className={ p.name }>{ p.version ? `${p.name}-${p.version}.${p.arch}` : p.name }</dd>);
            res.push(
                <dl key={ "package-" + type} className={type}>
                    {title && <dt>{title}</dt>}
                    {f}
                </dl>
            );
        }
    };

    render_list("adds", _("Additions"));
    render_list("removes", _("Removals"));
    render_list("up", _("Updates"));
    render_list("down", _("Downgrades"));
    render_list("rpms-col1");
    render_list("rpms-col2");
    return <div className="packages">{res}</div>;
};

Packages.propTypes = {
    packages: PropTypes.object,
};

const TreeDetails = ({ info }) => {
    if (!info)
        return null;
    return (
        <DescriptionList isHorizontal>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Operating system") }</DescriptionListTerm>
                <DescriptionListDescription className="os" id="osname">{info.osname.v}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Version") }</DescriptionListTerm>
                <DescriptionListDescription className="version" id="osversion">{info.version.v}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Released") }</DescriptionListTerm>
                <DescriptionListDescription className="timestamp" id="osrelease">{timeformat.distanceToNow(info.timestamp.v * 1000, true)}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Origin") }</DescriptionListTerm>
                <DescriptionListDescription className="origin" id="osorigin">{info.origin.v}</DescriptionListDescription>
            </DescriptionListGroup>
        </DescriptionList>
    );
};

const SignaturesDetails = ({ signatures }) => {
    if (signatures.length > 0) {
        return (signatures.map((sig, index) => {
            const when = new Date(sig.timestamp * 1000).toString();
            const validity = sig.valid ? _("Good signature") : (sig.expired ? _("Expired signature") : _("Invalid signature"));

            return (
                <DescriptionList isHorizontal key={index}>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{ _("Signed by") }</DescriptionListTerm>
                        <DescriptionListDescription id="signature-signed-by">{sig.by}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{ _("When") }</DescriptionListTerm>
                        <DescriptionListDescription id="signature-when">{when}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{ sig.fp_name }</DescriptionListTerm>
                        <DescriptionListDescription id="signature-name">{sig.fp}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{ _("Validity") }</DescriptionListTerm>
                        <DescriptionListDescription id="signature-valid">{validity}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            );
        }));
    } else {
        return (<p className="no-signatures">{ _("No signature available") }</p>);
    }
};

const Deployments = ({ versions }) => {
    const [inProgress, setInProgress] = useState({});
    const [openedKebab, _setOpenedKebab] = useState({});
    const [error, _setError] = useState({});

    const setError = (id, err) => {
        _setError({ ...error, [id]: err });
    };

    const setOpenedKebab = (id, state) => {
        _setOpenedKebab({ ...openedKebab, [id]: state });
    };

    const doRollback = (key, osname) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress({ ...inProgress, [key]: true });
        return client.run_transaction("Rollback", [args], osname)
                .catch(ex => setError(key, { title: _("Failed to roll back deployment"), details: ex }))
                .finally(() => setInProgress({ ...inProgress, [key]: false }));
    };

    const doUpgrade = (key, osname, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress({ ...inProgress, [key]: true });
        return client.run_transaction("Deploy", [checksum, args], osname)
                .catch(ex => setError(key, { title: _("Failed to upgrade deployment"), details: ex }))
                .finally(() => setInProgress({ ...inProgress, [key]: false }));
    };

    const doRebase = (key, osname, origin, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true),
            revision: cockpit.variant("s", checksum),
        };
        setInProgress({ ...inProgress, [key]: true });
        return client.run_transaction("Rebase", [args, origin, []], osname)
                .catch(ex => setError(key, { title: _("Failed to rebase deployment"), details: ex }))
                .finally(() => setInProgress({ ...inProgress, [key]: false }));
    };

    const items = versions.map(item => {
        const key = track_id(item);
        const packages = client.packages(item);
        return DeploymentDetails(key, item, packages, doRollback, doUpgrade, doRebase, inProgress[key], setError, error[key], setOpenedKebab, openedKebab[key]);
    });
    return (
        <ListingTable aria-label={_("Deployments and updates")}
                  id="available-deployments"
                  gridBreakPoint=''
                  columns={[{ title: _("Name") }, { title: _("State") }, { title: "" }]}
                  variant="compact"
                  rows={items} />
    );
};

const DeploymentDetails = (akey, info, packages, doRollback, doUpgrade, doRebase, inProgress, setError, error, setOpenedKebab, openedKebab) => {
    let name = null;
    if (info && info.osname) {
        name = info.osname.v;
        if (info.version)
            name += " " + info.version.v;
    }

    const isUpdate = () => {
        return client.item_matches(info, 'CachedUpdate') && !client.item_matches(info, 'DefaultDeployment');
    };

    const isRollback = () => {
        return !client.item_matches(info, 'CachedUpdate') && client.item_matches(info, 'RollbackDeployment');
    };

    const isRebase = () => {
        return !info.id && !client.item_matches(info, 'BootedDeployment', 'origin') && !client.item_matches(info, 'RollbackDeployment') &&
            !client.item_matches(info, "DefaultDeployment");
    };

    let state;
    if (inProgress)
        state = <Label icon={<PendingIcon />}>{_("Updating")}</Label>;
    else if (info.booted && info.booted.v)
        state = <Label color="green">{_("Running")}</Label>;
    else if (error)
        state = (
            <Popover headerContent={error.title} bodyContent={error.details} className="ct-popover-alert">
                <Label color="red"
                icon={<ErrorCircleOIcon />}
                className="deployment-error"
                closeBtnAriaLabel={_("Close")}
                onClose={() => setError(akey, null)}>
                    <>
                        {_("Failed")}
                        <Button variant="link" isInline>{_("view more...")}</Button>
                    </>
                </Label>
            </Popover>
        );
    else
        state = <Label>{_("Available")}</Label>;

    let action_name = null;
    let action = null;

    if (isUpdate()) {
        action_name = _("Update and reboot");
        action = () => doUpgrade(akey, info.osname.v, info.checksum.v);
    } else if (isRollback()) {
        action_name = _("Roll back and reboot");
        action = () => doRollback(akey, info.osname.v);
    } else if (isRebase()) {
        action_name = _("Rebase and reboot");
        action = () => doRebase(akey, info.osname.v, info.origin.v, info.checksum.v);
    }

    const columns = [
        { title: name, props: { className: "deployment-name" } },
        { title: state }
    ];

    if (action_name) {
        columns.push({
            title: <OverflowMenu breakpoint="lg">
                <OverflowMenuContent>
                    <OverflowMenuGroup groupType="button">
                        <OverflowMenuItem>
                            <Button size="sm" variant="secondary" onClick={action}>
                                {action_name}
                            </Button>
                        </OverflowMenuItem>
                    </OverflowMenuGroup>
                </OverflowMenuContent>
                <OverflowMenuControl>
                    <Dropdown position="right"
                              onSelect={() => setOpenedKebab(akey, !openedKebab)}
                              toggle={
                                  <KebabToggle onToggle={(_event, open) => setOpenedKebab(akey, open)} />
                              }
                              isOpen={openedKebab}
                              isPlain
                              dropdownItems={[<OverflowMenuDropdownItem key={action_name} isShared onClick={action}>
                                  {action_name}
                              </OverflowMenuDropdownItem>]}
                    />
                </OverflowMenuControl>
            </OverflowMenu>
        });
    } else {
        columns.push({ title: "" });
    }

    let signatures = [];
    if (info.signatures && info.signatures.v.length > 0)
        signatures = info.signatures.v.map((raw, index) => client.signature_obj(raw));

    const tabRenderers = [
        {
            name: _("Tree"),
            renderer: TreeDetails,
            data: { info },
        },
        {
            name: _("Packages"),
            renderer: Packages,
            data: { packages },
        },
        {
            name: _("Signatures"),
            renderer: SignaturesDetails,
            data: { signatures },
        },
    ];

    return ({
        props: { key: akey },
        columns,
        expandedContent: <ListingPanel tabRenderers={tabRenderers} />
    });
};

/**
 * Main application
 */
class Application extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            os: null,
            error: null,
            remotes: null,
            branches: null,
            branchLoadError: null,
            origin: { remote: null, branch: null },
            curtain: { state: 'silent', failure: false, message: null, final: false },
            progressMsg: undefined,
            isChangeRemoteOriginModalOpen: false,
        };

        this.onChangeBranch = this.onChangeBranch.bind(this);
        this.onChangeRemoteOrigin = this.onChangeRemoteOrigin.bind(this);
        this.refreshRemotes = this.refreshRemotes.bind(this);
        this.checkForUpgrades = this.checkForUpgrades.bind(this);

        /* show "connecting" curtain if connecting to client takes longer than 1s */
        let timeout;
        timeout = window.setTimeout(() => {
            this.setState({ curtain: { state: 'connecting', failure: false, message: null } });
            timeout = null;
        }, 1000);

        const check_empty = () => {
            window.clearTimeout(timeout);
            timeout = null;
            if (client.os_list && client.os_list.length === 0) {
                this.setState({ curtain: { state: 'empty', failure: true, message: _("No OSTree deployments found"), final: true } });
            } else {
                let newState;
                if (!this.state.origin.remote) {
                    const os = client.os_list[0];
                    const origin = client.get_default_origin(os) || {};
                    newState = {
                        curtain: { state: null },
                        os,
                        origin: { remote: origin.remote, branch: origin.branch },
                    };
                    this.setState(newState);
                }
                this.updateBranches(this.state.origin.remote || newState.origin.remote);
            }
        };

        const show_failure = ex => {
            if (Array.isArray(ex) && ex.length >= 1) {
                ex = ex[0];
            }
            let message = null;
            let final = false;

            if (ex.problem === "access-denied") {
                message = _("Not authorized to update software on this system");
            } else if (ex.problem === "not-found") {
                message = _("OSTree is not available on this system");
                final = true;
            } else {
                message = cockpit.message(ex);
            }

            this.setState({ curtain: { state: 'failed', failure: true, message, final } });
            set_page_status(null);
        };

        client.addEventListener("connectionLost", (event, ex) => show_failure(ex));
        client.addEventListener("changed", () => this.forceUpdate());

        client.connect()
                .then(() => {
                    timeout = window.setTimeout(check_empty, 1000);

                    /* notify overview card */
                    set_page_status({
                        type: null,
                        title: _("Checking for package updates..."),
                        details: {
                            link: false,
                            pficon: "spinner",
                        },
                    });
                })
                .catch(ex => {
                    window.clearTimeout(timeout);
                    show_failure(ex);
                });

        this.refreshRemotes();
    }

    onChangeRemoteOrigin(remote) {
        this.setState(prevState => ({
            origin: {
                ...prevState.origin,
                remote,
            }
        }));
        return this.updateBranches(remote).then(branches => {
            const newBranch = branches && branches.length ? branches[0] : this.state.origin.branch;
            return client.cache_update_for(this.state.os, remote, newBranch).catch(ex => console.warn(ex.message));
        });
    }

    checkForUpgrades() {
        this.setState({ progressMsg: _("Checking for updates") });

        return client.check_for_updates(this.state.os, this.state.origin.remote, this.state.origin.branch)
                .catch(ex => this.setState({ error: ex }))
                .finally(() => this.setState({ progressMsg: undefined }));
    }

    refreshRemotes() {
        remotes.listRemotes()
                .then(remotes => this.setState({ remotes }))
                .catch(ex => {
                    this.setState({
                        remotes: null,
                        branches: null,
                        curtain: { state: 'failed', failure: true, final: true, message: cockpit.format(_("Error loading remotes: $0"), cockpit.message(ex)) }
                    });
                });
    }

    onChangeBranch(branch) {
        this.setState(prevState => ({
            origin: {
                ...prevState.origin,
                branch,
            }
        }));
        return client.cache_update_for(this.state.os, this.state.origin.remote, branch);
    }

    updateBranches(remote) {
        if (!remote) {
            return;
        }

        return remotes.listBranches(remote)
                .then(branches => {
                    const update = { branches, branchLoadError: null };
                    // if current branch does not exist, change to the first listed branch
                    if (branches.indexOf(this.state.origin.branch) < 0)
                        update.origin = { remote: this.state.origin.remote, branch: branches[0] };
                    this.setState(update);
                    return branches;
                })
                .catch(ex => {
                    this.setState({
                        branches: null,
                        branchLoadError: cockpit.message(ex)
                    });
                });
    }

    render() {
        /* curtain: empty state pattern (connecting, errors) */
        const c = this.state.curtain;
        if (c.state)
            return <Curtain state={c.state} failure={c.failure} message={c.message} reconnect={!c.final} />;

        /* TODO: support more than one OS */

        /* successful, deployments are available */
        const versions = client.known_versions_for(this.state.os, this.state.origin.remote, this.state.origin.branch);
        set_update_status(versions);
        versions.forEach(item => {
            const packages = client.packages(item);
            if (packages)
                packages.addEventListener("changed", () => this.setState({})); // re-render
        });

        const actionButton = (
            <Button variant="secondary"
                    id="check-for-updates-btn"
                    isLoading={!!client.local_running || !!this.state.progressMsg}
                    isDisabled={!!client.local_running || !!this.state.progressMsg}
                    onClick={this.checkForUpgrades}>
                {_("Check for updates")}
            </Button>
        );

        return (
            <Page>
                <ChangeRemoteModal isModalOpen={this.state.isChangeRemoteOriginModalOpen}
                                   setIsModalOpen={isChangeRemoteOriginModalOpen => this.setState({ isChangeRemoteOriginModalOpen })}
                                   currentRemote={this.state.origin.remote}
                                   refreshRemotes={this.refreshRemotes}
                                   onChangeRemoteOrigin={this.onChangeRemoteOrigin}
                                   remotesList={this.state.remotes} />
                <PageSection variant={PageSectionVariants.light}
                             padding={{ default: 'noPadding' }}>
                    <OriginSelector os={this.state.os} remotes={this.state.remotes}
                                    branches={this.state.branches} branchLoadError={this.state.branchLoadError}
                                    currentRemote={this.state.origin.remote} currentBranch={this.state.origin.branch}
                                    setChangeRemoteModal={isChangeRemoteOriginModalOpen => this.setState({ isChangeRemoteOriginModalOpen })} onChangeBranch={this.onChangeBranch} />
                </PageSection>
                <PageSection>
                    {this.state.error && <Alert variant="danger" isInline title={this.state.error} />}
                    <Card id="deployments">
                        <CardHeader actions={{ actions: actionButton, hasNoOffset: false }}>
                            <CardTitle component="h2">{_("Deployments and updates")}</CardTitle>
                        </CardHeader>
                        <CardBody className="contains-list">
                            <Deployments versions={versions} />
                        </CardBody>
                    </Card>
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", function () {
    ReactDOM.render(React.createElement(Application, {}), document.getElementById('app'));
});
