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

"use strict";

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from "prop-types";

import './lib/patternfly/patternfly-4-cockpit.scss';

import {
    Title, Button, Alert,
    EmptyState, EmptyStateVariant, EmptyStateIcon, EmptyStateBody,
    DataList, DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataListContent,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Page, PageSection, PageSectionVariants,
    Select, SelectOption,
    Spinner,
    Toolbar, ToolbarItem, ToolbarContent,
    Nav, NavList, NavItem,
} from '@patternfly/react-core';
import { ExclamationCircleIcon, OutlinedCheckCircleIcon } from '@patternfly/react-icons';
import { debounce } from 'throttle-debounce';

import cockpit from 'cockpit';

import * as timeformat from 'timeformat';
import { superuser } from 'superuser';

import client from './client';
import * as remotes from './remotes';
import { ChangeRemoteModal } from './changeRemoteModal.jsx';

import './ostree.scss';

const _ = cockpit.gettext;

superuser.reload_page_on_change();

function track_id(item) {
    if (!item)
        return;

    var key = item.osname.v;
    if (item.id)
        key = key + item.id.v;

    if (item.checksum)
        key = key + item.checksum.v;

    return key;
}

function format_version(deployment) {
    var formatted = "";
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
        icon = <Spinner isSVG size="xl" />;
    else if (failure)
        icon = <EmptyStateIcon icon={ExclamationCircleIcon} />;

    let title;
    if (state === 'connecting')
        title = _("Connecting to OSTree");
    else if (state === 'failed')
        title = _("Unable to communicate with OSTree");
    else if (state === 'empty')
        title = _("No Deployments");

    return (
        <EmptyState variant={EmptyStateVariant.full}>
            {icon}
            <Title headingLevel="h5" size="lg">{title}</Title>
            { message && <EmptyStateBody>{message}</EmptyStateBody> }
            { (state === 'failed' && reconnect) && <Button variant="primary">{ _("Reconnect") }</Button> }
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
    const [progressMsg, setProgressMsg] = useState(undefined);
    const [error, setError] = useState("");

    if (!os)
        return null;

    const checkForUpgrades = () => {
        setProgressMsg(_("Checking for updates"));

        return client.check_for_updates(os, currentRemote, currentBranch)
                .catch(ex => setError(ex))
                .finally(() => setProgressMsg(undefined));
    };

    const origin = client.get_default_origin(os);

    if (!origin || !remotes || remotes.length === 0)
        return <Alert variant="default" isInline title={ _("No configured remotes") } />;

    return (
        <>
            <Toolbar id="repo-remote-toolbar" className="pf-m-page-insets">
                <ToolbarContent>
                    <ToolbarItem variant="label">{ _("Repository") }</ToolbarItem>
                    <ToolbarItem><Button id="change-repo" variant="link" isInline onClick={() => setChangeRemoteModal(true)}>{currentRemote}</Button></ToolbarItem>

                    <ToolbarItem variant="label" id="branch-select-label">{ _("Branch")}</ToolbarItem>
                    <ToolbarItem>
                        <Select aria-label={ _("Select branch") } ariaLabelledBy="branch-select-label"
                                toggleId="change-branch"
                                isOpen={branchSelectExpanded}
                                selections={currentBranch}
                                onToggle={exp => setBranchSelectExpanded(exp) }
                                onSelect={(event, branch) => { setBranchSelectExpanded(false); onChangeBranch(branch) } }>
                            { branchLoadError
                                ? [<SelectOption key="_error" isDisabled value={branchLoadError} />]
                                : (branches || []).map(branch => <SelectOption key={branch} value={branch} />)
                            }
                        </Select>
                    </ToolbarItem>
                    <ToolbarItem variant="separator" />
                    <ToolbarItem>
                        <Button variant="secondary"
                                id="check-for-updates-btn"
                                isLoading={!!client.local_running || !!progressMsg}
                                isDisabled={!!client.local_running || !!progressMsg}
                                onClick={checkForUpgrades}>
                            {_("Check for Updates")}
                        </Button>
                    </ToolbarItem>
                </ToolbarContent>
            </Toolbar>
            {branchLoadError && <Alert variant="warning" isInline title={branchLoadError} />}
            {error && <Alert className="upgrade-error" variant="warning" isInline title={error} />}
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
        return <p>{ _("This deployment contains the same packages as your currently booted system") }</p>;

    var res = [];

    const render_list = (type, title) => {
        if (packages[type]) {
            /* rpms{1,2} have version/arch in name, and the version/arch fields are undefined */
            const f = packages[type].map(p => <dd key={ p.name }>{ p.version ? `${p.name}-${p.version}.${p.arch}` : p.name }</dd>);
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
    return res;
};

Packages.propTypes = {
    packages: PropTypes.object,
};

const DeploymentVersion = ({ info, packages }) => {
    const [activeTabKey, setActiveTabKey] = useState('tree');
    const [inProgress, setInProgress] = useState(false);
    const [error, setError] = useState(undefined);

    const doRollback = (osname) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress(true);
        return client.run_transaction("Rollback", [args], osname)
                .catch(ex => setError(ex))
                .finally(() => setInProgress(false));
    };

    const doUpgrade = (osname, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true)
        };
        setInProgress(true);
        return client.run_transaction("Deploy", [checksum, args], osname)
                .catch(ex => setError(ex))
                .finally(() => setInProgress(false));
    };

    const doRebase = (osname, origin, checksum) => {
        const args = {
            reboot: cockpit.variant("b", true),
            revision: cockpit.variant("s", checksum),
        };
        setInProgress(true);
        return client.run_transaction("Rebase", [args, origin, []], osname)
                .catch(ex => setError(ex))
                .finally(() => setInProgress(false));
    };

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

    const id = track_id(info);
    let name = null;
    if (info && info.osname) {
        name = info.osname.v;
        if (info.version)
            name += " " + info.version.v;
    }

    let state;
    if (inProgress)
        state = _("Updating");
    else if (info.booted && info.booted.v)
        state = <span><OutlinedCheckCircleIcon color="green" /> { _("Running") }</span>;
    else if (error)
        state = <span className="deployment-error"><ExclamationCircleIcon color="red" />{ _("Failed") }</span>;
    else
        state = _("Available");

    const treeTab = (
        <DescriptionList isHorizontal>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Operating System") }</DescriptionListTerm>
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

    let signaturesTab;
    if (info.signatures && info.signatures.v.length > 0) {
        signaturesTab = [info.signatures.v.map((raw, index) => {
            const sig = client.signature_obj(raw);
            const when = new Date(sig.timestamp * 1000).toString();
            const validity = sig.valid ? _("Good Signature") : (sig.expired ? _("Expired Signature") : _("Invalid Signature"));

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
        })];
    } else {
        signaturesTab = <p>{ _("No signature available") }</p>;
    }

    return (
        <DataListItem aria-labelledby={id}>
            <DataListItemRow>
                <DataListItemCells dataListCells={[
                    <DataListCell key="name" width={4}> <span className="deployment-name" id={id}>{name}</span> </DataListCell>,
                    <DataListCell key="state" width={4}><span className="deployment-status">{state}</span></DataListCell>,
                    <DataListCell key="action" width={2}>
                        {isUpdate(info) && <Button variant="secondary"
                                                   onClick={() => doUpgrade(info.osname.v, info.checksum.v)}
                                                   isDisabled={!!client.local_running}>{_("Update and Reboot")}</Button>}
                        {isRollback(info) && <Button variant="secondary"
                                                     onClick={() => doRollback(info.osname.v)}
                                                     isDisabled={!!client.local_running}>{_("Roll Back and Reboot")}</Button>}
                        {isRebase(info) && <Button variant="secondary"
                                                   onClick={() => doRebase(info.osname.v, info.origin.v, info.checksum.v)}
                                                   isDisabled={!!client.local_running}>{_("Rebase and Reboot")}</Button>}
                    </DataListCell>,
                ]} />
            </DataListItemRow>
            <DataListContent aria-label={cockpit.format("$0 Details", name)} hasNoPadding id="available-deployments-expanded-content">
                <Nav variant="tertiary" onSelect={result => setActiveTabKey(result.itemId)}>
                    <NavList>
                        <NavItem isActive={activeTabKey === "tree"} itemId="tree">{ _("Tree") }</NavItem>
                        <NavItem isActive={activeTabKey === "packages"} itemId="packages">{ _("Packages") }</NavItem>
                        <NavItem isActive={activeTabKey === "signatures"} itemId="signatures">{ _("Signatures") }</NavItem>
                    </NavList>
                </Nav>
                {error && <Alert variant="danger" isInline title={error} />}
                <div className={'available-deployments-nav-content ' + activeTabKey}>
                    {activeTabKey === "tree" && treeTab}
                    {activeTabKey === "packages" && <Packages packages={packages} />}
                    {activeTabKey === "signatures" && signaturesTab}
                </div>
            </DataListContent>
        </DataListItem>
    );
};

DeploymentVersion.propTypes = {
    info: PropTypes.object.isRequired,
    packages: PropTypes.object,
};

/**
 * Main application
 */
class Application extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            os: null,
            remotes: null,
            branches: null,
            branchLoadError: null,
            origin: { remote: null, branch: null },
            curtain: { state: 'silent', failure: false, message: null, final: false },
            runningMethod: null, /* operation in progress, disables actions */
            showChangeRemoteDialog: null,
            isChangeRemoteOriginModalOpen: false,
        };

        this.onChangeBranch = this.onChangeBranch.bind(this);
        this.onChangeRemoteOrigin = this.onChangeRemoteOrigin.bind(this);
        this.refreshRemotes = this.refreshRemotes.bind(this);

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
                remote: remote,
            }
        }));
        return this.updateBranches(remote).then(branches => {
            const newBranch = branches && branches.length ? branches[0] : this.state.origin.branch;
            return client.cache_update_for(this.state.os, remote, newBranch).catch(ex => console.warn(ex.message));
        });
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
                branch: branch,
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

        const items = versions.map(item => {
                              const packages = client.packages(item);
                              if (packages)
                                  packages.addEventListener("changed", () => this.setState({})); // re-render
                              return <DeploymentVersion key={ track_id(item) } info={item} packages={packages} />;
                          });

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
                    <DataList className="available-deployments" aria-label={ _("available deployments") }>{items}</DataList>
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", function () {
    ReactDOM.render(React.createElement(Application, {}), document.getElementById('app'));
});
