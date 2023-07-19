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
import { createRoot } from 'react-dom/client';
import PropTypes from "prop-types";
import { debounce } from 'throttle-debounce';

import 'patternfly/patternfly-5-cockpit.scss';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card";
import { EmptyState, EmptyStateIcon, EmptyStateBody, EmptyStateHeader, EmptyStateFooter, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import {
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription
} from "@patternfly/react-core/dist/esm/components/DescriptionList";
import { Gallery, } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Label, } from "@patternfly/react-core/dist/esm/components/Label";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal";
import { Page, PageSection, } from "@patternfly/react-core/dist/esm/components/Page";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner";
import { Text } from "@patternfly/react-core/dist/esm/components/Text";

import { Dropdown, DropdownItem, DropdownSeparator, KebabToggle, } from "@patternfly/react-core/dist/esm/deprecated/components/Dropdown";

import { BugIcon, CheckIcon, ExclamationCircleIcon, ExclamationTriangleIcon, PendingIcon, ErrorCircleOIcon, CheckCircleIcon, SyncAltIcon } from '@patternfly/react-icons';

import cockpit from 'cockpit';

import * as timeformat from 'timeformat';
import { superuser } from 'superuser';
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';

import client from './client';
import * as remotes from './remotes';
import { AddRepositoryModal, EditRepositoryModal, RebaseRepositoryModal, RemoveRepositoryModal } from './repositoryModals.jsx';

import './ostree.scss';
import { CleanUpModal, ResetModal } from './deploymentModals';
import { WithDialogs, DialogsContext, useDialogs } from "dialogs.jsx";

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
                <DescriptionListDescription className="version" id="osversion">{info.version?.v}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Released") }</DescriptionListTerm>
                <DescriptionListDescription className="timestamp" id="osrelease">{timeformat.distanceToNow(info.timestamp.v * 1000, true)}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{ _("Origin") }</DescriptionListTerm>
                <DescriptionListDescription className="origin" id="osorigin">{info.origin?.v}</DescriptionListDescription>
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
    const Dialogs = useDialogs();
    const [inProgress, setInProgress] = useState({});
    const [error, _setError] = useState({});

    const setError = (id, err) => {
        _setError({ ...error, [id]: err });
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

    const columns = [
        {
            title: _("Version"),
            props: { width: 15, },
        },
        {
            title: _("Status"),
            props: { width: 15, },
        },
        {
            title: _("Time"),
            props: { width: 15, },
        },
        {
            title: _("Branch"),
        },
        {
            title: "",
            props: { className: "pf-v5-c-table__action" }
        },
    ];

    const items = versions.map(item => {
        const key = track_id(item);
        const packages = client.packages(item);
        return DeploymentDetails(key, item, packages, doRollback, doUpgrade, doRebase, inProgress[key], setError, error[key], Dialogs);
    });

    return (
        <ListingTable aria-label={_("Deployments and updates")}
                  id="available-deployments"
                  columns={columns}
                  variant="compact"
                  gridBreakPoint="grid-lg"
                  rows={items} />
    );
};

const isUpdate = (info) => {
    return client.item_matches(info, 'CachedUpdate') && !client.item_matches(info, 'DefaultDeployment');
};

const isRollback = (info) => {
    return !client.item_matches(info, 'CachedUpdate') && client.item_matches(info, 'RollbackDeployment');
};

const isRebase = (info) => {
    return !info.id && !client.item_matches(info, 'BootedDeployment', 'origin') && !client.item_matches(info, 'RollbackDeployment') &&
        !client.item_matches(info, "DefaultDeployment");
};

const ConfirmDeploymentChange = ({ actionName, bodyText, onConfirmAction }) => {
    const Dialogs = useDialogs();

    const actions = [
        <Button key="confirm-action" variant="warning"
            onClick={() => { onConfirmAction(); Dialogs.close() }}
        >
            {cockpit.format(_("$0 and reboot"), actionName)}
        </Button>,
        <Button key="cancel-action" variant="link" onClick={Dialogs.close}>
            {_("Cancel")}
        </Button>
    ];

    const titleContent = (
        <Flex justifyContent={{ default: "justifyContentFlexStart" }} spacer={{ default: 'spaceItemsSm' }}
            flexWrap={{ default: 'nowrap' }}
        >
            <FlexItem>
                <ExclamationTriangleIcon className="pf-v5-u-warning-color-100" />
            </FlexItem>
            <FlexItem>
                <Text>{`${actionName}?`}</Text>
            </FlexItem>
        </Flex>
    );

    return (
        <Modal isOpen
            id="confirm-modal"
            title={titleContent}
            position="top"
            variant="small"
            onClose={Dialogs.close}
            actions={actions}
        >
            <Text>{bodyText}</Text>
        </Modal>
    );
};

const DeploymentDetails = (akey, info, packages, doRollback, doUpgrade, doRebase, inProgress, setError, error, Dialogs) => {
    const version = info.version ? info.version.v : null;

    const labels = [];
    if (inProgress)
        labels.push(<Label icon={<PendingIcon />} key={"updating" + version}>{_("Updating")}</Label>);
    if (info.booted && info.booted.v)
        labels.push(<Label color="blue" key={"current" + version} icon={<CheckCircleIcon />}>{_("Current")}</Label>);
    if (info?.pinned?.v)
        labels.push(<Label color="grey" key={"pinned" + version}>{_("Pinned")}</Label>);
    if (error)
        labels.push(
            <Popover headerContent={error.title}
                bodyContent={error.details}
                className="ct-popover-alert"
                key={"error" + version}
            >
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
    if (isUpdate(info) || isRebase(info))
        labels.push(<Label color="green" key={"new" + version}>{_("New")}</Label>);

    let action_name = null;
    let action = null;
    const releaseTime = timeformat.distanceToNow(info.timestamp.v * 1000, true);

    if (isUpdate(info)) {
        action_name = "update";
        action = () => Dialogs.show(<ConfirmDeploymentChange actionName={action_name}
            bodyText={cockpit.format(_("System will rebase to $0, updated $1."), version, releaseTime)}
            onConfirmAction={() => doUpgrade(akey, info.osname.v, info.checksum.v)}
        />);
    } else if (isRollback(info)) {
        action_name = "rollback";
        action = () => Dialogs.show(<ConfirmDeploymentChange actionName={action_name}
            bodyText={cockpit.format(_("System will rebase to $0, updated $1."), version, releaseTime)}
            onConfirmAction={() => doRollback(akey, info.osname.v)}
        />);
    } else if (isRebase(info)) {
        action_name = "rebase";
        action = () => Dialogs.show(<ConfirmDeploymentChange actionName={action_name}
            bodyText={cockpit.format(_("System will rebase to $0, updated $1."), version, releaseTime)}
            onConfirmAction={() => doRebase(akey, info.osname.v, info.origin.v, info.checksum.v)}
        />);
    }

    const action_button_text = {
        update: _("Update"),
        rollback: _("Roll back"),
        rebase: _("Rebase"),
    };
    const columns = [
        { title: version, props: { className: "deployment-name" } },
        {
            title: (
                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                    {labels}
                </Flex>
            ),
        }
    ];

    columns.push({ title: releaseTime });

    columns.push({ title: info.origin?.v });

    if (action_name) {
        columns.push({
            title: (
                <Flex justifyContent={{ default: "justifyContentFlexEnd" }}>
                    <Button size="sm" onClick={action}
                        variant={action_name === "rollback" ? "secondary" : "primary"}
                    >
                        {action_button_text[action_name]}
                    </Button>
                </Flex>
            ),
        });
    } else {
        columns.push({ title: "" });
    }

    if (info.index !== undefined) {
        columns.push({
            title: (
                <DeploymentActions deploymentIndex={info.index}
                    deploymentIsPinned={info?.pinned?.v}
                    isCurrent={info.booted.v}
                    isStaged={info.staged.v}
                />
            ),
            props: { className: "pf-v5-c-table__action" }
        });
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

const DeploymentActions = ({ deploymentIndex, deploymentIsPinned, isCurrent, isStaged }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);

    const togglePin = () => {
        const pinFlags = [];
        if (deploymentIsPinned) {
            pinFlags.push("--unpin");
        }

        cockpit.spawn(["ostree", "admin", "pin", ...pinFlags, deploymentIndex], { superuser: "try" })
                .then(() => setKebabOpen(false));
    };

    const deleteDeployment = () => {
        cockpit.spawn(["ostree", "admin", "undeploy", deploymentIndex], { superuser: "try" })
                .then(() => setKebabOpen(false));
    };

    const actions = [];
    if (!isStaged) {
        actions.push(
            <DropdownItem key="pin-deployment"
                onClick={() => togglePin()}
            >
                {deploymentIsPinned ? _("Unpin") : _("Pin")}
            </DropdownItem>,
        );
    }

    if (!isCurrent) {
        if (actions.length > 0) {
            actions.push(<DropdownSeparator key="deployment-actions-separator-1" />);
        }
        actions.push(
            <DropdownItem key="delete-deployment"
                className="pf-v5-u-danger-color-200"
                onClick={() => deleteDeployment()}
            >
                {_("Delete")}
            </DropdownItem>
        );
    }

    return (
        <Dropdown toggle={<KebabToggle onToggle={(_event, isOpen) => setKebabOpen(isOpen)} />}
            isOpen={isKebabOpen}
            id="deployment-actions"
            isPlain
            position="right"
            dropdownItems={actions} />
    );
};

const OStreeStatus = ({ ostreeState, versions }) => {
    const updates = versions.filter(version => isUpdate(version));

    const statusItems = [];
    if (updates.length) {
        statusItems.push({
            key: "update-available",
            icon: <BugIcon />,
            message: _("Update available"),
        });
    } else {
        statusItems.push({
            key: "up-to-date",
            icon: <CheckIcon color="green" />,
            message: _("System is up to date"),
        });
    }

    if (ostreeState.branchLoadError) {
        const [errorName, errorDetail] = ostreeState.branchLoadError.replace("error: ", "").split(';');
        statusItems.push({
            key: "status-error",
            icon: <ExclamationTriangleIcon className="pf-v5-u-warning-color-100" />,
            message: (
                <>
                    <Text>
                        {errorName}
                    </Text>
                    <Text component="small" className="pf-v5-u-color-200">
                        {errorDetail}
                    </Text>
                </>
            ),
        });
    }

    return (
        <Card className="ct-card-info" id="ostree-status">
            <CardHeader>
                <CardTitle component="h2">{_("Status")}</CardTitle>
            </CardHeader>
            <CardBody>
                <List isPlain>
                    {statusItems.map(item => (
                        <ListItem key={item.key}>
                            <Flex spacer={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                                <FlexItem>{item.icon}</FlexItem>
                                <FlexItem>{item.message}</FlexItem>
                            </Flex>
                        </ListItem>
                    ))}
                </List>
            </CardBody>
        </Card>
    );
};

OStreeStatus.propTypes = {
    ostreeState: PropTypes.object.isRequired,
    versions: PropTypes.array.isRequired,
};

const OStreeSource = ({ ostreeState, refreshRemotes, onChangeBranch, onChangeRemoteOrigin }) => {
    const Dialogs = useDialogs();
    const [isKebabOpen, setKebabOpen] = useState(false);

    const actions = [
        <DropdownItem key="rebase"
            isDisabled={!ostreeState.branches && !ostreeState.branchLoadError}
            onClick={() => Dialogs.show(
                <RebaseRepositoryModal origin={ostreeState.origin}
                    availableRemotes={ostreeState.remotes}
                    currentOriginBranches={ostreeState.branches}
                    currentBranchLoadError={ostreeState.branchLoadError}
                    onChangeBranch={onChangeBranch}
                    onChangeRemoteOrigin={onChangeRemoteOrigin}
                />
            )}
        >
            {_("Rebase")}
        </DropdownItem>,
        <DropdownSeparator key="separator-1" />,
        <DropdownItem key="add-repository"
            onClick={() => Dialogs.show(
                <AddRepositoryModal refreshRemotes={refreshRemotes} />
            )}
        >
            {_("Add repository")}
        </DropdownItem>,
        <DropdownItem key="edit-repository"
            onClick={() => Dialogs.show(
                <EditRepositoryModal remote={ostreeState.origin.remote}
                    availableRemotes={ostreeState.remotes}
                />
            )}
        >
            {_("Edit repository")}
        </DropdownItem>,
        <DropdownItem key="remove-repository"
            onClick={() => Dialogs.show(
                <RemoveRepositoryModal origin={ostreeState.origin}
                    availableRemotes={ostreeState.remotes}
                    refreshRemotes={refreshRemotes}
                />
            )}
        >
            {_("Remove repository")}
        </DropdownItem>,
    ];

    const ostreeSourceActions = (
        <Dropdown toggle={<KebabToggle onToggle={(_, isOpen) => setKebabOpen(isOpen)} />}
            isPlain
            isOpen={isKebabOpen}
            position="right"
            id="ostree-source-actions"
            dropdownItems={actions}
        />
    );

    return (
        <Card className="ct-card-info" id="ostree-source">
            <CardHeader actions={{ actions: ostreeSourceActions }}>
                <CardTitle component="h2">{_("OStree source")}</CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList isHorizontal>
                    <DescriptionListGroup id="current-repository">
                        <DescriptionListTerm>{_("Repository")}</DescriptionListTerm>
                        <DescriptionListDescription>{ostreeState.origin.remote}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup id="current-branch">
                        <DescriptionListTerm>{_("Branch")}</DescriptionListTerm>
                        <DescriptionListDescription>{ostreeState.origin.branch}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );
};

OStreeSource.propTypes = {
    ostreeState: PropTypes.object.isRequired,
    refreshRemotes: PropTypes.func.isRequired,
    onChangeBranch: PropTypes.func.isRequired,
    onChangeRemoteOrigin: PropTypes.func.isRequired,
};

/**
 * Main application
 */
class Application extends React.Component {
    static contextType = DialogsContext;

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
            isKebabOpen: false,
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
        this.setState({
            progressMsg: _("Checking for updates"),
            error: "",
        });

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
        const Dialogs = this.context;
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

        const kebabActions = [
            <DropdownItem key="clean-up"
                          onClick={() => Dialogs.show(<CleanUpModal os={this.state.os} />)}>
                {_("Clean up")}
            </DropdownItem>,
            <DropdownSeparator key="deployment-separator-1" />,
            <DropdownItem key="reset"
                          className="pf-v5-u-danger-color-200"
                          onClick={() => Dialogs.show(<ResetModal os={this.state.os} />)}>
                {_("Reset")}
            </DropdownItem>,
        ];

        const cardActions = (
            <Flex>
                <Button variant="secondary"
                        id="check-for-updates-btn"
                        isLoading={!!client.local_running || !!this.state.progressMsg}
                        isDisabled={!!client.local_running || !!this.state.progressMsg}
                        onClick={this.checkForUpgrades}>
                    <SyncAltIcon />
                </Button>
                <Dropdown toggle={<KebabToggle onToggle={(_, isOpen) => this.setState({ isKebabOpen: isOpen })} />}
                    isPlain
                    isOpen={this.state.isKebabOpen}
                    position="right"
                    id="deployments-actions"
                    dropdownItems={kebabActions}
                />
            </Flex>
        );

        return (
            <Page>
                <PageSection>
                    <Gallery hasGutter className="ct-cards-grid">
                        <OStreeStatus ostreeState={this.state} versions={versions} />
                        <OStreeSource ostreeState={this.state} refreshRemotes={this.refreshRemotes} onChangeBranch={this.onChangeBranch} onChangeRemoteOrigin={this.onChangeRemoteOrigin} />
                        <Card id="deployments" isSelectable isClickable>
                            {this.state.error && <Alert variant="danger" isInline title={this.state.error} />}
                            <CardHeader actions={{ actions: cardActions, hasNoOffset: false }}>
                                <CardTitle component="h2">{_("Deployments and updates")}</CardTitle>
                            </CardHeader>
                            <CardBody className="contains-list">
                                <Deployments versions={versions} />
                            </CardBody>
                        </Card>
                    </Gallery>
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("app")).render(<WithDialogs><Application /></WithDialogs>);
});
