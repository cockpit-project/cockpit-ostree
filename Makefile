# extract name from package.json
PACKAGE_NAME := $(shell awk '/"name":/ {gsub(/[",]/, "", $$2); print $$2}' package.json)
RPM_NAME := $(PACKAGE_NAME)
VERSION := $(shell T=$$(git describe 2>/dev/null) || T=1; echo $$T | tr '-' '.')
ifeq ($(TEST_OS),)
TEST_OS = fedora-coreos
endif
export TEST_OS
TARFILE=$(RPM_NAME)-$(VERSION).tar.xz
NODE_CACHE=$(RPM_NAME)-node-$(VERSION).tar.xz
SPEC=$(RPM_NAME).spec
PREFIX ?= /usr/local
VM_IMAGE=$(CURDIR)/test/images/$(TEST_OS)
# stamp file to check for node_modules/
NODE_MODULES_TEST=package-lock.json
# one example file in dist/ from bundler to check if that already ran
DIST_TEST=dist/manifest.json
# one example file in pkg/lib to check if it was already checked out
COCKPIT_REPO_STAMP=pkg/lib/cockpit-po-plugin.js
# common arguments for tar, mostly to make the generated tarballs reproducible
TAR_ARGS = --sort=name --mtime "@$(shell git show --no-patch --format='%at')" --mode=go=rX,u+rw,a-s --numeric-owner --owner=0 --group=0

ifeq ($(TEST_COVERAGE),yes)
RUN_TESTS_OPTIONS+=--coverage
NODE_ENV=development
endif

all: $(DIST_TEST)

# checkout common files from Cockpit repository required to build this project;
# this has no API stability guarantee, so check out a stable tag when you start
# a new project, use the latest release, and update it from time to time
COCKPIT_REPO_FILES = \
	pkg/lib \
	test/common \
	$(NULL)

COCKPIT_REPO_URL = https://github.com/cockpit-project/cockpit.git
COCKPIT_REPO_COMMIT = d32340cd69824da5dd27549a4eed889d1d83b3c5 # 349

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
	xgettext --default-domain=$(PACKAGE_NAME) --output=- --language=C --keyword= \
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 $$(find src/ -name '*.[jt]s' -o -name '*.[jt]sx') | \
		sed '/^#/ s/, c-format//' > $@

po/$(PACKAGE_NAME).html.pot: $(NODE_MODULES_TEST) $(COCKPIT_REPO_STAMP)
	pkg/lib/html2po -o $@ $$(find src -name '*.html')

po/$(PACKAGE_NAME).manifest.pot: $(COCKPIT_REPO_STAMP)
	pkg/lib/manifest2po -o $@ src/manifest.json

po/$(PACKAGE_NAME).pot: po/$(PACKAGE_NAME).html.pot po/$(PACKAGE_NAME).js.pot po/$(PACKAGE_NAME).manifest.pot
	msgcat --sort-output --output-file=$@ $^

#
# Build/Install/dist
#

%.spec: %.spec.in
	sed -e 's/%{VERSION}/$(VERSION)/g' $< > $@

$(DIST_TEST): $(NODE_MODULES_TEST) $(COCKPIT_REPO_STAMP) $(shell find src/ -type f) package.json build.js
	NODE_ENV=$(NODE_ENV) ./build.js

watch: $(NODE_MODULES_TEST) $(COCKPIT_REPO_STAMP)
	NODE_ENV=$(NODE_ENV) ./build.js -w

clean:
	rm -rf dist/
	rm -f $(SPEC)

install: $(DIST_TEST)
	mkdir -p $(DESTDIR)$(PREFIX)/share/cockpit/$(PACKAGE_NAME)
	cp -r dist/* $(DESTDIR)$(PREFIX)/share/cockpit/$(PACKAGE_NAME)

# this requires a built source tree and avoids having to install anything system-wide
devel-install: $(DIST_TEST)
	mkdir -p ~/.local/share/cockpit
	ln -s `pwd`/dist ~/.local/share/cockpit/$(PACKAGE_NAME)

# assumes that there was symlink set up using the above devel-install target,
# and removes it
devel-uninstall:
	rm -f ~/.local/share/cockpit/$(PACKAGE_NAME)

print-version:
	@echo "$(VERSION)"

dist: $(TARFILE)
	@ls -1 $(TARFILE)

# when building a distribution tarball, call bundler with a 'production' environment by default
# we don't ship node_modules for license and compactness reasons; we ship a
# pre-built dist/ (so it's not necessary) and ship package-lock.json (so that
# node_modules/ can be reconstructed if necessary)
$(TARFILE): export NODE_ENV ?= production
$(TARFILE): $(DIST_TEST) $(SPEC)
	tar --xz $(TAR_ARGS) -cf $(TARFILE) --transform 's,^,$(RPM_NAME)/,' \
		--exclude $(SPEC).in --exclude node_modules --exclude test/reference \
		$$(git ls-files) $(COCKPIT_REPO_FILES) $(NODE_MODULES_TEST) $(SPEC) dist/

$(NODE_CACHE): $(NODE_MODULES_TEST)
	tar --xz $(TAR_ARGS) -cf $@ node_modules

node-cache: $(NODE_CACHE)

# convenience target for developers
srpm: $(TARFILE) $(NODE_CACHE) $(SPEC)
	rpmbuild -bs \
	  --define "_sourcedir `pwd`" \
	  --define "_srcrpmdir `pwd`" \
	  $(SPEC)

# convenience target for developers
rpm: $(TARFILE) $(NODE_CACHE) $(SPEC)
	mkdir -p "`pwd`/output"
	mkdir -p "`pwd`/rpmbuild"
	rpmbuild -bb \
	  --define "_sourcedir `pwd`" \
	  --define "_specdir `pwd`" \
	  --define "_builddir `pwd`/rpmbuild" \
	  --define "_srcrpmdir `pwd`" \
	  --define "_rpmdir `pwd`/output" \
	  --define "_buildrootdir `pwd`/build" \
	  $(SPEC)
	find `pwd`/output -name '*.rpm' -printf '%f\n' -exec mv {} . \;
	rm -r "`pwd`/rpmbuild"
	rm -rf "`pwd`/output" "`pwd`/build"

# build a VM with locally built rpm installed, cockpit/ws container, and local
# ostree for testing
$(VM_IMAGE): rpm bots
	rm -f $(VM_IMAGE) $(VM_IMAGE).qcow2
	bots/image-customize -v --no-network \
		--upload $$(ls $(PACKAGE_NAME)-*.noarch.rpm):/tmp/ \
		--script $(CURDIR)/test/vm.install $(TEST_OS)

# convenience target for the above
vm: $(VM_IMAGE)
	@echo $(VM_IMAGE)

# convenience target to print the filename of the test image
print-vm:
	@echo $(VM_IMAGE)

# run the QUnit tests
check-unit: $(NODE_MODULES_TEST)
	npm run test

codecheck: test/common $(NODE_MODULES_TEST)
	test/common/static-code

# convenience target to setup all the bits needed for the integration tests
# without actually running them
prepare-check: $(NODE_MODULES_TEST) $(VM_IMAGE) test/common test/reference

# run the browser integration tests; skip check for SELinux denials
# this will run all tests/check-* and format them as TAP
check: prepare-check check-unit
	TEST_AUDIT_NO_SELINUX=1 test/common/run-tests ${RUN_TESTS_OPTIONS}

# checkout Cockpit's bots for standard test VM images and API to launch them
bots: $(COCKPIT_REPO_STAMP)
	test/common/make-bots

test/reference: test/common
	test/common/pixel-tests pull

$(NODE_MODULES_TEST): package.json
	# if it exists already, npm install won't update it; force that so that we always get up-to-date packages
	rm -f package-lock.json
	# unset NODE_ENV, skips devDependencies otherwise
	env -u NODE_ENV npm install
	env -u NODE_ENV npm prune

.PHONY: all clean install devel-install devel-uninstall print-version dist node-cache srpm rpm prepare-check check check-unit vm print-vm
