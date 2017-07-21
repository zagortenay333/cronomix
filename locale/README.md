To add a translation: 

1. Create a po file from `po/template.pot` for your language inside the `po` dir.
1. Run the `compile` script.
1. Make a pull request.

If the `po/template.pot` file has been changed, then the po files can be updated
by running the `merge` script. Typically I will run this script myself each time 
I make changes to `po/template.pot`, but you should run it yourself just to make
sure.  
After that, you can go through your po file and add translations where they are
missing.
