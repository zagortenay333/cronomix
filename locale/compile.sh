#!/bin/sh

pofiles=$(find po -name "*.po")

for i in $pofiles; do
    lang=$(echo $i | sed -n 's:po/\([A-Za-z_]\+\)\.po:\1:p')
    mkdir -p ${lang}/LC_MESSAGES/
	msgfmt po/${lang}.po -o ${lang}/LC_MESSAGES/${lang}.mo
done
