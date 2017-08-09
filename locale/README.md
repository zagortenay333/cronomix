To add a translation: 
1. [Create a po file](https://www.gnu.org/software/gettext/manual/gettext.html#Creating) for your language from the `po/template.pot` file.
1. Send the po file to me in one of these ways:
    1. Place your po file into the `po` dir, run the `compile` script and make a pull request.
    1. Or send the `po` file in some other (non-git) way (open an issue on github, email, etc..)

As the extension changes, the `po/template.pot` file might change too, and the po files will need to be updated.
To update the po files:
1. Run the `merge` script.
1. Go through your po file and check whether there are any missing translations.

If you edited the extension yourself, you can update the `po/template.pot` file by running the `extract` script.
