To add a translation: 

1. [Create a po file](https://www.gnu.org/software/gettext/manual/gettext.html#Creating) for your language from the `po/template.pot` file.
1. Send the po file to me in one of these ways:
    1. Place your po file into the `po` dir, run the `compile` script and make a pull request.
    1. Or send the `po` file in some other (non-git) way (open an issue on github, email, etc..)

If the `po/template.pot` file has been changed, then the po files can be updated
by running the `merge` script. Typically, I will run this script myself each time 
I make changes to `po/template.pot`, but you should run it yourself just to make
sure.  
After that, you can go through your po file and add translations where they are
missing.

If you edited the extension yourself, then you can update the `po/template.pot`
file by running the `extract` script.
