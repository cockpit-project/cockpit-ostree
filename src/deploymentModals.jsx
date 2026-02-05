/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2023 Red Hat, Inc.
 */

import React, { useState } from 'react';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox';
import { Content } from "@patternfly/react-core/dist/esm/components/Content";
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal';
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack";
import { useDialogs } from "dialogs.jsx";

import cockpit from 'cockpit';

import client from './client';

const _ = cockpit.gettext;

export const CleanUpModal = ({ os }) => {
    const Dialogs = useDialogs();

    const [deleteTemporaryFiles, setDeleteTemporaryFiles] = useState(true);
    const [deleteRPMmetadata, setDeleteRPMmetadata] = useState(true);
    const [deletePendingDeployments, setDeletePendingDeployments] = useState(false);
    const [deleteRollbackDeployments, setDeleteRollbackDeployments] = useState(false);
    const [buttonLoading, setButtonLoading] = useState(false);
    const [error, setError] = useState("");

    const doCleanup = () => {
        setButtonLoading(true);
        setError("");

        const cleanupFlags = [];
        if (deleteTemporaryFiles) {
            cleanupFlags.push("base");
        }
        if (deleteRPMmetadata) {
            cleanupFlags.push("repomd");
        }
        if (deletePendingDeployments) {
            cleanupFlags.push("pending-deploy");
        }
        if (deleteRollbackDeployments) {
            cleanupFlags.push("rollback-deploy");
        }

        return client.run_transaction("Cleanup", [cleanupFlags], os)
                .then(Dialogs.close)
                .catch(ex => {
                    console.warn(ex);
                    setError(ex.message);
                    setButtonLoading(false);
                });
    };

    return (
        <Modal isOpen
            id="cleanup-deployment-modal"
            position="top"
            variant="small"
            onClose={Dialogs.close}
        >
            <ModalHeader title={_("Clear cache and deployments")} />
            <ModalBody>
                {error &&
                    <Alert variant="danger"
                        isInline
                        title={error}
                    />
                }
                <Stack>
                    <Checkbox label={_("Temporary files")}
                        key="temporary-files"
                        id="temporary-files-checkbox"
                        onChange={(_, isChecked) => setDeleteTemporaryFiles(isChecked)}
                        isChecked={deleteTemporaryFiles}
                    />
                    <Checkbox label={_("RPM repo metadata")}
                        key="rpm-repo-metadata"
                        id="rpm-repo-metadata-checkbox"
                        onChange={(_, isChecked) => setDeleteRPMmetadata(isChecked)}
                        isChecked={deleteRPMmetadata}
                    />
                    <Checkbox label={_("Pending deployment")}
                        key="pending-deployment"
                        id="pending-deployment-checkbox"
                        onChange={(_, isChecked) => setDeletePendingDeployments(isChecked)}
                        isChecked={deletePendingDeployments}
                    />
                    <Checkbox label={_("Rollback deployment")}
                        key="rollback-deployment"
                        id="rollback-deployment-checkbox"
                        onChange={(_, isChecked) => setDeleteRollbackDeployments(isChecked)}
                        isChecked={deleteRollbackDeployments}
                    />
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button key="cleanup-accept"
                    variant="primary"
                    isAriaDisabled={buttonLoading || (!deleteTemporaryFiles && !deleteRPMmetadata && !deletePendingDeployments && !deleteRollbackDeployments)}
                    isLoading={buttonLoading}
                    onClick={() => doCleanup()}
                >
                    {_("Clean up")}
                </Button>
                <Button key="cleanup-cancel" variant="link" onClick={Dialogs.close}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

export const ResetModal = ({ os }) => {
    const Dialogs = useDialogs();

    const [removeOverlays, setRemoveOverlays] = useState(false);
    const [removeOverrides, setRemoveOverrides] = useState(false);
    const [error, setError] = useState("");
    const [buttonLoading, setButtonLoading] = useState(false);

    const doReset = () => {
        setButtonLoading(true);
        setError("");

        const resetFlags = {};
        if (removeOverlays) {
            // remove all overlayed packages
            resetFlags["no-layering"] = { t: "b", v: true };
        }
        if (removeOverrides) {
            // remove all overrides
            resetFlags["no-overrides"] = { t: "b", v: true };
        }

        return client.run_transaction("UpdateDeployment", [{}, resetFlags], os)
                .then(Dialogs.close)
                .catch(ex => {
                    console.warn(ex);
                    setError(ex.message);
                    setButtonLoading(false);
                });
    };

    return (
        <Modal isOpen
            id="reset-modal"
            position="top"
            variant="small"
            onClose={Dialogs.close}
        >
            <ModalHeader title={_("Reset")}
                titleIconVariant="warning"
            />
            <ModalBody>
                {error &&
                    <Alert variant="danger"
                        isInline
                        title={error}
                    />
                }
                <Content component="p">
                    {_("Remove package additions or substitutions to return the current deployment to its original state.")}
                </Content>
                <Stack>
                    <Checkbox label={_("Remove overlays")}
                        key="remove-overlays"
                        id="remove-overlays-checkbox"
                        onChange={(_, isChecked) => setRemoveOverlays(isChecked)}
                        isChecked={removeOverlays}
                        description={_("Packages which have been added to the system")}
                    />
                    <Checkbox label={_("Remove overrides")}
                        key="remove-overrides"
                        id="remove-overrides-checkbox"
                        onChange={(_, isChecked) => setRemoveOverrides(isChecked)}
                        isChecked={removeOverrides}
                        description={_("Substitutions of packages normally included in an OS build")}
                    />
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button key="reset-accept"
                    variant="warning"
                    isLoading={buttonLoading}
                    isAriaDisabled={buttonLoading}
                    onClick={() => doReset()}>
                    {_("Reset to original state")}
                </Button>
                <Button key="reset-cancel" variant="link" onClick={Dialogs.close}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
