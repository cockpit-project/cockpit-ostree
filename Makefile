# extract name from package.json
PACKAGE_NAME := $(shell awk '/"name":/ {gsub(/[",]/, "", $$2); print $$2}' package.json)
VERSION := $(shell T=$$(git describe 2>/dev/null) || T=1; echo $$T | tr '-' '.')
ifeq ($(TEST_OS),)
TEST_OS = fedora-coreos
endif
export TEST_OS
TARFILE=$(PACKAGE_NAME)-$(VERSION).tar.xz
NODE_CACHE=$(PACKAGE_NAME)-node-$(VERSION).tar.xz
# rpmspec -q behaves differently in Fedora ≥ 37
RPMQUERY=$(shell rpmspec -D"VERSION $(VERSION)" -q --srpm $(PACKAGE_NAME).spec.in).rpm
SRPMFILE=$(subst noarch,src,$(RPMQUERY))
RPMFILE=$(subst src,noarch,$(RPMQUERY))
PREFIX ?= /usr/local
VM_IMAGE=$(CURDIR)/test/images/$(TEST_OS)
# stamp file to check if/when npm install ran
NODE_MODULES_TEST=package-lock.json
# one example file in dist/ from webpack to check if that already ran
WEBPACK_TEST=dist/manifest.json
# one example file in pkg/lib to check if it was already checked out
COCKPIT_REPO_STAMP=pkg/lib/cockpit-po-plugin.js

all: $(WEBPACK_TEST)

# checkout common files from Cockpit repository required to build this project;
# this has no API stability guarantee, so check out a stable tag when you start
# a new project, use the latest release, and update it from time to time
COCKPIT_REPO_FILES = \
	pkg/lib \
	test/common \
	tools/git-utils.sh \
	tools/make-bots \
	$(NULL)

COCKPIT_REPO_URL = https://github.com/cockpit-project/cockpit.git
COCKPIT_REPO_COMMIT = bc5ea7cc137ffc2f4de23976ac3893896a837c0d # 285

$(COCKPIT_REPO_FILES): $(COCKPIT_REPO_STAMP)
COCKPIT_REPO_TREE = '$(strip $(COCKPIT_REPO_COMMIT))^{tree}'
$(COCKPIT_REPO_STAMP): Makefile
	@git rev-list --quiet --objects $(COCKPIT_REPO_TREE) -- 2>/dev/null || \
	    git fetch --no-tags --no-write-fetch-head --depth=1 $(COCKPIT_REPO_URL) $(COCKPIT_REPO_COMMIT)
	git archive $(COCKPIT_REPO_TREE) -- $(COCKPIT_REPO_FILES) | tar x

#
# i18n
#

po/$(PACKAGE_NAME).js.pot:
	xgettext --default-domain=cockpit --output=$@ --language=C --keyword= \
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 $$(find src/ -name '*.js' -o -name '*.jsx')

po/$(PACKAGE_NAME).html.pot: $(NODE_MODULES_TEST)
	po/html2po -o $@ $$(find src -name '*.html')

po/$(PACKAGE_NAME).manifest.pot: $(NODE_MODULES_TEST)
	po/manifest2po src/manifest.json -o $@

po/$(PACKAGE_NAME).pot: po/$(PACKAGE_NAME).html.pot po/$(PACKAGE_NAME).js.pot po/$(PACKAGE_NAME).manifest.pot
	msgcat --sort-output --output-file=$@ $^

#
# Build/Install/dist
#

%.spec: %.spec.in
	sed -e 's/%{VERSION}/$(VERSION)/g' $< > $@

$(WEBPACK_TEST): $(NODE_MODULES_TEST) $(COCKPIT_REPO_STAMP) $(shell find src/ -type f) package.json webpack.config.js
	NODE_ENV=$(NODE_ENV) node_modules/.bin/webpack

watch:
	NODE_ENV=$(NODE_ENV) node_modules/.bin/webpack --watch

clean:
	rm -rf dist/
	[ ! -e $(PACKAGE_NAME).spec.in ] || rm -f $(PACKAGE_NAME).spec

install: $(WEBPACK_TEST)
	mkdir -p $(DESTDIR)$(PREFIX)/share/cockpit/$(PACKAGE_NAME)
	cp -r dist/* $(DESTDIR)$(PREFIX)/share/cockpit/$(PACKAGE_NAME)

# this requires a built source tree and avoids having to install anything system-wide
devel-install: $(WEBPACK_TEST)
	mkdir -p ~/.local/share/cockpit
	ln -s `pwd`/dist ~/.local/share/cockpit/$(PACKAGE_NAME)

dist: $(TARFILE)
	@ls -1 $(TARFILE)

# when building a distribution tarball, call webpack with a 'production' environment
# we don't ship node_modules for license and compactness reasons; we ship a
# pre-built dist/ (so it's not necessary) and ship package-lock.json (so that
# node_modules/ can be reconstructed if necessary)
$(TARFILE): NODE_ENV=production
$(TARFILE): $(WEBPACK_TEST) $(PACKAGE_NAME).spec
	touch -r package.json $(NODE_MODULES_TEST)
	touch dist/*
	tar --xz -cf $(TARFILE) --transform 's,^,$(PACKAGE_NAME)/,' \
		--exclude $(PACKAGE_NAME).spec.in --exclude node_modules --exclude test/reference \
		$$(git ls-files) pkg/lib package-lock.json $(PACKAGE_NAME).spec dist/

$(NODE_CACHE): $(NODE_MODULES_TEST)
	tar --xz -cf $@ node_modules

node-cache: $(NODE_CACHE)

srpm: $(SRPMFILE)

$(SRPMFILE): $(TARFILE) $(PACKAGE_NAME).spec
	rpmbuild -bs \
	  --define "_sourcedir `pwd`" \
	  --define "_srcrpmdir `pwd`" \
	  $(PACKAGE_NAME).spec

rpm: $(RPMFILE)

# this is a noarch build, so local rpm build works fine for recent OSes
$(RPMFILE): $(SRPMFILE) bots
	test/rpmbuild-local $(SRPMFILE)

# build a VM with locally built rpm installed, cockpit/ws container, and local
# ostree for testing
$(VM_IMAGE): rpm bots
	rm -f $(VM_IMAGE) $(VM_IMAGE).qcow2
	bots/image-customize -v --upload $$(ls $(PACKAGE_NAME)-*.noarch.rpm):/tmp/ \
		--no-network \
		--run-command 'rpm -q cockpit-ostree && rpm-ostree --cache-only override replace /tmp/*.rpm || rpm-ostree --cache-only install /tmp/*.rpm' \
		$(TEST_OS)
	# building the local tree needs the modified tree from above booted already
	bots/image-customize -v --no-network --script $(CURDIR)/test/vm.install $(TEST_OS)

# convenience target for the above
vm: $(VM_IMAGE)
	echo $(VM_IMAGE)

# run the QUnit tests
check-unit: $(NODE_MODULES_TEST)
	npm run test

# run the browser integration tests; skip check for SELinux denials
# this will run all tests/check-* and format them as TAP
check: $(NODE_MODULES_TEST) $(VM_IMAGE) test/common test/reference check-unit
	TEST_AUDIT_NO_SELINUX=1 test/common/run-tests ${RUN_TESTS_OPTIONS}

# checkout Cockpit's bots for standard test VM images and API to launch them
bots: tools/make-bots
	tools/make-bots

$(NODE_MODULES_TEST): package.json
	# if it exists already, npm install won't update it; force that so that we always get up-to-date packages
	rm -f package-lock.json
	# unset NODE_ENV, skips devDependencies otherwise
	env -u NODE_ENV npm install
	env -u NODE_ENV npm prune

.PHONY: all clean install devel-install dist node-cache srpm rpm check check-unit vm
