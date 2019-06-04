# -*- coding: utf-8; mode: makefile-gmake -*-
# Basic Makefile

UUID = timepp@zagortenay333
INSTALLNAME = $(UUID)

BASE_MODULES = \
  ./extension.js \
  ./README* \
	./CREDITS.md \
	./COPYING \
  ./metadata.json \
  ./prefs.js \
  ./stylesheet.css \
	./data \
	./dbus \
	./lib \
	./locale \
	./sections

# ---------
# variables
# ---------

INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions

# VERBOSE level
VV = -v

# -------
# macros
# -------

# usage: $(call reload-extension $(UUID))
reload-extension = $(shell gnome-shell-extension-tool -r $(1))

# usage: $(call msg,INFO,'lorem ipsum')
msg = @printf '  [%-12s] %s\n' '$(1)' '$(2)'


# -------
# targets
# -------

# is there anymore use of the (old) 'all' target?
# PHONY += all
# all: extension

PHONY += help
help:
	@echo  'Install or remove (and reload) of the extension, for the local user'
	@echo  ''
	@echo  '  make [install|remove]                        # for the local user'
	@echo  ''
	@echo  'Other targets are:'
	@echo  ''
	@echo  '  reload    - reload extension $(UUID)'
	@echo  '  clean     - remove most generated files'
	@echo  ''

PHONY += install remove build clean

install: remove build
	$(call msg,$@ $(INSTALLBASE)/$(INSTALLNAME))
	$(Q) mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	$(Q) cp $(VV) -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	$(Q) $(MAKE) -s reload
	$(call msg,$@,OK)

remove:
	$(call msg,$@ $(INSTALLBASE)/$(INSTALLNAME))
	$(Q) rm $(VV) -fr $(INSTALLBASE)/$(INSTALLNAME)
	$(Q) $(MAKE) -s reload
	$(call msg,$@,OK)

build: 
	$(Q)mkdir -p _build
	$(Q)cp $(VV) -R $(BASE_MODULES) _build
	$(call msg,$@,OK)

clean:
	$(Q)rm -fR ./_build
	$(call msg,$@,OK)


reload:
	$(call reload-extension,$(UUID))
	$(call msg,$@,OK)


.PHONY: $(PHONY)
