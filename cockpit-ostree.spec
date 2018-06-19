Name: cockpit-ostree
Version: 170
Release: 0
BuildArch: noarch
Summary: Cockpit user interface for rpm-ostree
License: LGPLv2.1+
Requires: cockpit-bridge >= 125
Requires: cockpit-system >= 125
Requires: /usr/libexec/rpm-ostreed

Source: cockpit-ostree.tar.gz

%description
Cockpit component for managing software updates for ostree based systems.

%prep
%setup -n cockpit-ostree

%build
make

%install
make install DESTDIR=%{buildroot}
find %{buildroot} -type f >> files.list
sed -i "s|%{buildroot}||" *.list

%files -f files.list
