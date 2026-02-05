/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2016 Red Hat, Inc.
 */

import QUnit from 'qunit';

import * as utils from './utils.js';

const sample_config = `
key = value

[section]
key=section
 indented = commas, or spaces

[ section2 ]
key = section2
not a value
another=value
`;

QUnit.test("parseData", assert => {
    const expected = {
        key: "value",
        section: {
            indented: "commas, or spaces",
            key: "section",
        },
        section2: {
            key: "section2",
            another: "value"
        }
    };

    assert.deepEqual(utils.parseData(""), {}, "empty string");
    assert.deepEqual(utils.parseData(null), {}, "null string");
    assert.deepEqual(utils.parseData(), {}, "undefined string");
    assert.deepEqual(utils.parseData("invalid"), {}, "invalid config");
    assert.deepEqual(utils.parseData(sample_config), expected, "parse sample config");
});

QUnit.test("changeData", assert => {
    assert.deepEqual(utils.changeData(null, "section", {
        key: "value2",
        bool1: true,
        bool2: false,
    }),
                     "\n[section]\nkey = value2\nbool1 = true\nbool2 = false\n\n",
                     "new file");
    assert.deepEqual(utils.changeData("[other-section]\ndata=data\nline", "section", {
        key: "value2",
        bool1: true,
        bool2: false,
    }),
                     "[other-section]\ndata=data\nline\n\n[section]\nkey = value2\nbool1 = true\nbool2 = false\n\n",
                     "new section");
    assert.deepEqual(utils.changeData("[other-section]\ndata=data\nline\nsome line\nmore lines\n[section]\nkey = old\ntodelete=value\nbool1 = true\nbool2 = false\n[more]\nkey=value", "section", {
        key: "value2",
        todelete: null,
        bool1: false,
        bool2: true,
        new: "new"
    }),
                     "[other-section]\ndata=data\nline\nsome line\nmore lines\n[section]\nkey = value2\nbool1 = false\nbool2 = true\nnew = new\n\n[more]\nkey=value",
                     "change section");
});
