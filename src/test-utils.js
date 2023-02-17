/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
