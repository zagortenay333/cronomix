**To add a translation:**
1. [Create a po file](https://www.gnu.org/software/gettext/manual/gettext.html#Creating) for your language from the `template.pot` file.
1. Send the `.po` file to me in one of these ways:
    1. Place your `.po` file into the `po` dir, run the `compile` script and make a pull request.
    1. Or send the `.po` file in some other (non-git) way. (Open an issue on github, email, etc...)
    
---
    
**To update an existing `.po` file:**
1. Run the `merge` script.
1. Go through the `.po` file and check whether there are any missing/fuzzy translations.

---

If you edited the extension yourself, you can update the `template.pot` file by running the `extract` script.
