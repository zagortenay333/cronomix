# Time ++ ![icon banner](img/banner.png)

A [todo.txt manager](https://github.com/ginatrapani/todo.txt-cli/wiki/The-Todo.txt-Format),
time tracker, timer, stopwatch, pomodoro, and alarms gnome-shell extension.

Cinnamon applet version: https://github.com/zagortenay333/timepp__cinnamon

---

### Installation

* You can install this extension from the [gnome-shell extensions site](https://extensions.gnome.org/extension/1238/time/).

* You can install it manually by cloning/downloading this repo into your `~/.local/share/gnome-shell/extensions` dir
and renaming the downloaded folder to `timepp@zagortenay333`.

---

### Compatibility

The latest version of this extension is on the master branch, and it supports
gnome-shell version `3.24`.

---

### Sections

Each section (timer, stopwatch, alarms..) can open as a separate menu when it's
icon is clicked, or it can appear together with other sections in one menu.

Individual sections can be disabled.

---

### Todo.txt Manager

Some of the features of the todo.txt manager are:

* Fuzzy task searching.
* Filtering by context, project, priority, custom fuzzy filters...
* Activating a filter by clicking on a priority, context, or proj in the task.
* Support for multiple todo files and corresponding done files and csv dirs.
* Sorting by priority, due date, completion date, creation date.
* Fuzzy autocompletion for contexts and projects when inline editing a task.
* Autoupdating when the todo.txt file changes.
* Deleting all completed tasks and optionally storing them into a done.txt file.
* Switching between different views via keyboard shortcuts.

The todo.txt manager also supports the `h:1` extension for hiding a task and the
`due|DUE:yyyy-mm-dd` extension.

---

### Time Tracker

The time tracker is built into the todo.txt manager and allows you to track the
time spent on a particular task as well as the time spent on a particular project.

When pressing the play button to track a task, all projects associated with that
task will also be tracked.

At the start of each year, the current yearly csv file will be archived and a 
new file will be started.

There is also a daily csv file which gets appended to the yearly file at the 
start of each day.

> **NOTE:**  
> When editing a task that has been time-tracked, only the corresponding entry
in the daily csv file will be updated. The yearly csv file will not be changed.

> **HINT:**  
> There is an option to pause the time tracker when the pomodoro stops!

You can also see how much time you spent working on a task today, this week, 
this month, this year, etc, or do the same for all projects in the current year.

The csv file has the form:

```csv
date, time spent (hh:mm), type ('++' = project, '()' = task), task or project

2017-02-04, 08:03, ++, "+my_project"
2017-02-04, 23:59, ++, "+protect_gotham"
2017-02-04, 02:03, ++, "+protect_gotham"
2017-02-04, 02:03, (), "(A) Watch the world burn."
2017-02-04, 02:03, (), "(A) Catch Joker."
2017-02-04, 02:03, (), "(Z) Take the trash out."
2017-02-05, 08:03, ++, "+my_project"
2017-02-05, 23:59, ++, "+protect_gotham"
2017-02-05, 02:03, ++, "+protect_gotham"
2017-02-05, 02:03, (), "(A) Watch the world burn."
2017-02-05, 02:03, (), "x 2017-02-05 Catch Joker."
2017-02-05, 02:03, (), "(Z) Take the trash out."
.
.
.
```

---

### Custom Theme Support

This extension supports custom themes. In order to style it, place a
`timepp.css` file in your theme's root directory _(the dir where the
`gnome-shell.css` file is)_.

You must use the `!important` directive in order to override a property from the
extensions' stylesheet.

---

### Pango Markup

The todo.txt manager, timer and alarm support
[pango markup](https://developer.gnome.org/pango/stable/PangoMarkupFormat.html).


> **NOTE:**  
> The pango markup will appear in the `todo.txt` file as well if used in the 
todo.txt manager.  
> Notifications will only show the `<b>`, `<i>`, `<u>` tags and links.

---

### Lock Screen

**Note that all gnome-shell extensions get disabled in the lock screen**.

Alarms, stopwatch and other timers won't work when the screen is locked.

---

![preview](https://i.imgur.com/bhf1SSG.png)
<sup>**Preview info:** [Gnome-Shell theme](https://github.com/zagortenay333/ciliora-tertia-shell)</sup>
