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

const configRegex = {
    /* section headers, ei: [section] */
    section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
    /* parameters, ei: key=value */
    param: /^\s*([\w._-]+)\s*=\s*(.*?)\s*$/,
    /* new lines, used to split config data */
    lines: /\r\n|\r|\n/
};

function formatOption(key, value) {
    return key + " = " + value;
}

function formatOptions(options) {
    const output = [];
    let k, v;
    for ([k, v] of Object.entries(options)) {
        if (v || v === false)
            output.push(formatOption(k, v));
    }
    return output.join("\n") + "\n\n";
}

export function parseData(string) {
    const data = {};
    const lines = string ? string.split(configRegex.lines) : [];
    let section = null;

    lines.forEach(line => {
        if (configRegex.param.test(line)) {
            const m = line.match(configRegex.param);
            if (section)
                data[section][m[1]] = m[2];
            else
                data[m[1]] = m[2];
        } else if (configRegex.section.test(line)) {
            const m = line.match(configRegex.section);
            section = m[1].trim();
            data[section] = {};
        }
    });

    return data;
}

export function changeData(string, section, options) {
    const lines = string ? string.split(configRegex.lines) : [];
    let in_section = false;
    const remaining = options;
    let output = "";
    let i;

    /* Find the section and set any existing options */
    for (i = 0; i < lines.length; i++) {
        let line = lines[i];
        let m, k;
        if (configRegex.section.test(line)) {
            /* Leaving section stop processing */
            if (in_section)
                break;
            m = line.match(configRegex.section);
            k = m[1].trim();
            in_section = section === k;
        } else if (in_section && configRegex.param.test(line)) {
            m = line.match(configRegex.param);
            k = m[1];
            /* null means remove option */
            if (remaining[k] === null)
                line = null;
            /* If present set it */
            else if (remaining[k] !== undefined)
                line = formatOption(k, remaining[k]);

            delete remaining[k];
        }

        if (line !== null)
            output += line + "\n";
    }

    /* Create the section if needed */
    if (!in_section)
        output += "\n[" + section + "]\n";

    /* Add any remaining options */
    output += formatOptions(remaining);

    /* Add any remaining lines */
    if (i < lines.length)
        output += lines.slice(i).join("\n");

    return output;
}
