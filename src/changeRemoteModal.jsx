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

import React, { useState } from 'react';
import PropTypes from "prop-types";

import {
    Title, Button, Alert, AlertActionCloseButton,
    Form, FormGroup, ActionGroup,
    TextInput, TextArea,
    Checkbox,
    SimpleList, SimpleListItem,
    Modal,
} from '@patternfly/react-core';
import { PencilAltIcon, AddCircleOIcon } from '@patternfly/react-icons';

import * as remotes from './remotes';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const ChangeRemoteModal = ({ setIsModalOpen, isModalOpen, remotesList, currentRemote, refreshRemotes, onChangeRemoteOrigin }) => {
    const [addNewRepoDialogOpen, setAddNewRepoDialogOpen] = useState(false);
    const [editRepoDialogOpen, setEditRepoDialogOpen] = useState(false);
    const [selectedRemote, setSelectedRemote] = useState(currentRemote);
    const [error, setError] = useState("");

    // Disable 'Change Repository' button when the 'Edit' form is open or when the previously selected remote does not exit any more (got deleted)
    const footer = (
        <>
            <Button key="change-repo"
                variant="primary"
                isDisabled={!!editRepoDialogOpen || !remotesList.includes(selectedRemote)}
                onClick={() => {
                    onChangeRemoteOrigin(selectedRemote).then(() => setIsModalOpen(false), ex => setError(ex.message));
                }}>
                {_("Change repository")}
            </Button>
            <Button key="cancel" variant="link" onClick={() => setIsModalOpen(false)}>
                {_("Cancel")}
            </Button>
        </>
    );

    return (
        <Modal title={_("Change repository")}
               position="top"
               variant="medium"
               appendTo={document.body}
               isOpen={isModalOpen}
               onClose={() => setIsModalOpen(false)}
               footer={footer}>
            <>
                {error && <Alert variant="danger" isInline title={error} />}
                <SimpleList className="remote-select" onSelect={(_, currentItemProps) => setSelectedRemote(currentItemProps.id)}>
                    {(remotesList || []).map(remote => {
                        return (
                            (!editRepoDialogOpen || editRepoDialogOpen.name !== remote)
                                ? <SimpleListItem key={remote}
                                              id={remote}
                                              component="a"
                                              onClick={ev => {
                                                  ev.stopPropagation();
                                                  ev.preventDefault();
                                              }}
                                              isCurrent={remote === selectedRemote}>
                                    <span>{remote}</span>
                                    <Button onClick={ ev => {
                                        remotes.loadRemoteSettings(remote)
                                                .then(remoteSettings => setEditRepoDialogOpen(Object.assign(remoteSettings, { name: remote })));
                                    }}
                                        className="edit-remote"
                                        variant="secondary">
                                        <PencilAltIcon />
                                    </Button>
                                </SimpleListItem>
                                : <div key={remote} className="pf-c-simple-list__item-link">
                                    <EditRemoteForm setEditRepoDialogOpen={setEditRepoDialogOpen} remoteSettings={editRepoDialogOpen} refreshRemotes={refreshRemotes} />
                                </div>
                        );
                    }).concat([
                        !addNewRepoDialogOpen
                            ? <SimpleListItem component="a"
                                        onClick={ev => {
                                            ev.stopPropagation();
                                            ev.preventDefault();
                                        }}
                                        key="add-new">
                                <Button onClick={ev => {
                                    ev.stopPropagation();
                                    ev.preventDefault();
                                    setAddNewRepoDialogOpen(true);
                                }}
                                   variant="link"
                                   icon={<AddCircleOIcon />}
                                   id="add-new-remote-btn"
                                   iconPosition="left">{_("Add new repository")}</Button>
                            </SimpleListItem>
                            : <div key="add new" className="pf-c-simple-list__item-link">
                                <AddNewRepoForm refreshRemotes={refreshRemotes} setAddNewRepoDialogOpen={setAddNewRepoDialogOpen} />
                            </div>
                    ])}
                </SimpleList>
            </>
        </Modal>
    );
};

ChangeRemoteModal.propTypes = {
    remotesList: PropTypes.array.isRequired,
    currentRemote: PropTypes.string.isRequired,
    isModalOpen: PropTypes.bool.isRequired,
    setIsModalOpen: PropTypes.func.isRequired,
    refreshRemotes: PropTypes.func.isRequired,
    onChangeRemoteOrigin: PropTypes.func.isRequired,
};

const AddNewRepoForm = ({ setAddNewRepoDialogOpen, refreshRemotes }) => {
    const [newRepoName, setNewRepoName] = useState("");
    const [newRepoURL, setNewRepoURL] = useState("");
    const [newRepoTrusted, setNewRepoTrusted] = useState(false);

    const [hasValidation, setHasValidation] = useState(false);
    const [addNewRepoError, setAddNewRepoError] = useState(undefined);

    const onAddRemote = () => {
        if (!(newRepoURL.trim().length && newRepoName.trim().length)) {
            setHasValidation(true);
            return;
        }
        return remotes.addRemote(newRepoName, newRepoURL, newRepoTrusted)
                .then(() => refreshRemotes())
                .then(() => setAddNewRepoDialogOpen(false),
                      ex => setAddNewRepoError(ex.message));
    };

    return (
        <Form isHorizontal>
            <Title headingLevel="h3" size="l">
                {_("Add new repository")}
            </Title>
            {addNewRepoError && <Alert variant="danger" isInline title={addNewRepoError} />}
            <FormGroup label={_("Name")}
                       fieldId="new-remote-name"
                       helperTextInvalid={_("Please provide a valid name")}
                       validated={(hasValidation && !newRepoName.trim().length) ? "error" : undefined}
                       isRequired>
                <TextInput id="new-remote-name"
                           value={newRepoName}
                           isRequired
                           type="text"
                           onChange={name => setNewRepoName(name)} />
            </FormGroup>
            <FormGroup label={_("URL")}
                       fieldId="new-remote-url"
                       helperTextInvalid={_("Please provide a valid URL")}
                       validated={(hasValidation && !newRepoURL.trim().length) ? "error" : undefined}
                       isRequired>
                <TextInput id="new-remote-url"
                           value={newRepoURL}
                           isRequired
                           type="text"
                           onChange={url => setNewRepoURL(url)} />
            </FormGroup>
            <FormGroup fieldId="new-gpg-verify">
                <Checkbox label={_("Use trusted GPG key")}
                          id="new-gpg-verify"
                          isChecked={newRepoTrusted}
                          onChange={(checked, ev) => {
                              setNewRepoTrusted(checked);
                          }} />
            </FormGroup>
            <ActionGroup>
                <Button id="add-remote-btn" onClick={() => onAddRemote()} variant="primary">{_("Add")}</Button>
                <Button onClick={() => setAddNewRepoDialogOpen(false)} variant="link">{_("Cancel")}</Button>
            </ActionGroup>
        </Form>
    );
};
AddNewRepoForm.propTypes = {
    refreshRemotes: PropTypes.func.isRequired,
    setAddNewRepoDialogOpen: PropTypes.func.isRequired,
};

const EditRemoteForm = ({ remoteSettings, setEditRepoDialogOpen, refreshRemotes }) => {
    const [addAnotherKey, setAddAnotherKey] = useState(false);
    const [key, setKey] = useState('');
    const [isTrusted, setIsTrusted] = useState(remoteSettings['gpg-verify'] !== 'false');
    const [error, setError] = useState('');

    const onUpdate = () => {
        const promises = [];
        if (key)
            promises.push(remotes.importGPGKey(remoteSettings.name, key));
        promises.push(remotes.updateRemoteSettings(remoteSettings.name, { "gpg-verify": isTrusted }));

        Promise.all(promises).then(() => setEditRepoDialogOpen(false), ex => setError(ex.message));
    };
    const onDelete = () => {
        remotes.deleteRemote(remoteSettings.name)
                .then(() => refreshRemotes())
                .then(setEditRepoDialogOpen(false), ex => setError(ex.message));
    };

    return (
        <Form isHorizontal>
            {error && <Alert variant="danger" isInline
                             action={<AlertActionCloseButton onClose={() => this.setState({ error: undefined })} />}
                             title={error} />}
            <Title headingLevel="h3" size="l">
                {remoteSettings.name}
            </Title>
            <FormGroup label={_("URL")}
                fieldId="edit-remote-url">
                <TextInput id="edit-remote-url"
                           value={remoteSettings.url}
                           readOnly
                           type="text" />
            </FormGroup>
            <FormGroup fieldId="edit-remote-trusted">
                <Checkbox label={_("Use trusted GPG key")}
                          id="gpg-verify"
                          isChecked={isTrusted}
                          onChange={(checked, ev) => {
                              setIsTrusted(!isTrusted);
                          }} />
            </FormGroup>
            <FormGroup fieldId="add-another-key">
                {!addAnotherKey
                    ? <Button isInline variant="secondary" id='add-another-key' onClick={() => setAddAnotherKey(true)}>{_("Add another key")}</Button>
                    : <TextArea id='gpg-data'
                             placeholder={ cockpit.format(_("Begins with $0"), "'-----BEGIN GPG PUBLIC KEY BLOCK-----'") }
                             value={key} onChange={setKey} aria-label={_("GPG public key")} />}
            </FormGroup>
            <ActionGroup>
                <Button isInline variant="danger" className="delete-btn" onClick={onDelete}>{_("Delete")}</Button>
                <Button isInline variant="primary" className="apply-btn" onClick={onUpdate}>{_("Apply")}</Button>
                <Button isInline variant="link" onClick={() => setEditRepoDialogOpen(false)} className="cancel-btn">{_("Cancel")}</Button>
            </ActionGroup>
        </Form>
    );
};
EditRemoteForm.propTypes = {
    refreshRemotes: PropTypes.func.isRequired,
    setEditRepoDialogOpen: PropTypes.func.isRequired,
    remoteSettings: PropTypes.object.isRequired,
};
