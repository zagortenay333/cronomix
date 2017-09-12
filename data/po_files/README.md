**To add a translation:**
1. [Create a po file](https://www.gnu.org/software/gettext/manual/gettext.html#Creating) for your language from the `template.pot` file.
1. Send the `.po` file to me in one of these ways:
    * Place your `.po` file into the `po` dir, run the `compile` script, and make a pull request.
    * Send the `.po` file in some other (non-git) way: open an issue on github, email, etc...
    
---
    
**To update an existing `.po` file:**
1. Run the `merge` script.
1. Go through the `.po` file and check whether there are any missing/fuzzy translations.

---

**To update the `template.pot` file** in case you edited the extension yourself:
1. Run the `extract` script.
