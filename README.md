<div align="center">

### Time ++

<img vspace="70" src="data/img/logo.png"></img>

**A [todo.txt manager](https://github.com/todotxt/todotxt/),
time tracker, timer, stopwatch, pomodoro, and alarms [gnome-shell extension](https://extensions.gnome.org/about/).**

</div>

---

<details>
    <summary><b>Table of Contents</b></summary>
        
* [Installation](#installation)
* [Compatibility](#compatibility)
* [Translations](#translations)
* [Lock Screen](#lock-screen)
* [Sections](#sections)
* [Fullscreen interface](#fullscreen-interface)
* [Todo.txt Manager](#todotxt-manager)
    * [Supported todotxt extensions](#supported-todotxt-extensions)
* [Time Tracker](#time-tracker)
* [Todo.txt syntax](#todotxt-syntax)
* [DBus API](#dbus-api)
* [Custom Theme Support](#custom-theme-support)
* [Preview](#preview)

</details>

---

### Installation

* You can install this extension from the [gnome-shell extensions
site](https://extensions.gnome.org/extension/1238/time/).
  > **NOTE**:  
  > Since it takes some time for the extension to be reviewed, the version on
  > this site might be out of date and contain
  > bugs that have already been fixed. Consider using the github version.

* You can install it manually by cloning/downloading this repo into your
`~/.local/share/gnome-shell/extensions` dir
and renaming the downloaded dir to `timepp@zagortenay333`.  
After that, restart
gnome-shell (_<kbd>Alt</kbd>+<kbd>F2</kbd> then type `r`_) and enable the
extension via gnome-tweaks tool.

---

### Compatibility

The latest version of this extension is on the master branch, and it supports
gnome-shell version **`3.24`** and **`3.26`**.

---

### Translations

If you want to help out with translations, check out the instructions in the
[po_files](data/po_files) dir.

---

### Lock Screen

:bangbang: **Note that all gnome-shell extensions get disabled in the lock screen**.

Alarms, stopwatch and other timers won't work when the screen is locked.

---

### Sections

Each section (timer, stopwatch, alarms..) can open as a separate menu when it's
icon is clicked, or it can appear together with other sections in one menu.

Individual sections can be disabled.

Right-clicking on the panel icons will open a context section with
some useful links.

---

### Fullscreen Interface

This extension has a fullscreen interface, which can be used to control a
corresponding section as well as replace regular notifications.

The interface has multi-monitor support, and it can be opened _(and brought into
focus)_ via a keyboard shortcut.

When in fullscreen, some keyboard shortcuts are available:

<table>
    <th align="left" colspan="2">All</th>
    <tr>
        <td><kbd>Tab</kbd></td>
        <td>navigate forward</td>
    </tr>
    <tr>
        <td><kbd>Ctrl</kbd> + <kbd>Tab</kbd></td>
        <td>navigate backward</td>
    </tr>
    <tr>
        <td><kbd>Esc</kbd></td>
        <td>close fullscreen</td>
    </tr>
</table>

<table>
    <th align="left" colspan="2">Timer</th>
    <tr>
        <td><kbd>space</kbd></td>
        <td>stop/start timer</td>
    </tr>
    <tr>
        <td><kbd>r</kbd> or <kbd>Backspace</kbd></td>
        <td>repeat last timer preset</td>
    </tr>
    <tr>
        <td><kbd>1</kbd> ... <kbd>9</kbd> and <kbd>0</kbd></td>
        <td>start timer at the time specified by a num key.<br><i>1=1min,
2=2min, ..., 0=10min</i></td>
    </tr>
</table>

<table>
    <th align="left" colspan="2">Stopwatch</th>
    <tr>
        <td><kbd>space</kbd></td>
        <td>stop/start timer</td>
    </tr>
    <tr>
        <td><kbd>l</kbd> or <kbd>Enter</kbd></td>
        <td>lap</td>
    </tr>
    <tr>
        <td><kbd>r</kbd> or <kbd>Backspace</kbd></td>
        <td>reset</td>
    </tr>
</table>

<table>
    <th align="left" colspan="2">Pomodoro</th>
    <tr>
        <td><kbd>space</kbd></td>
        <td>stop/start timer</td>
    </tr>
</table>

<table>
    <th align="left" colspan="2">Stats View</th>
    <tr>
        <td><kbd>f</kbd> or <kbd>/</kbd></td>
        <td>start searching history</td>
    </tr>
</table>

---

### Todo.txt Manager

Some of the features of the todo.txt manager are:

* Fuzzy task searching.
* Filtering by context, project, priority, custom fuzzy filters...
* Toggling a filter on/off by clicking on a priority, context, or proj in a task.
* Support for multiple todo files and corresponding done files and csv dirs.
* Compound sorting by priority, due date, completion date, creation date, etc...
* Fuzzy autocompletion for contexts and projects when inline editing a task.
* Autoupdating when the todo.txt file changes.
* Deleting all completed tasks and optionally storing them into a done.txt file.
* Switching between different views via keyboard shortcuts.

---

### Todo.txt syntax

* The todo.txt format is specified here: https://github.com/todotxt/todo.txt

* In various places throughout this extension (todo.txt, alarms, timer) there is
support for some **markup** stuff:

    * There is support for [pango markup](https://developer.gnome.org/pango/stable/PangoMarkupFormat.html).

    * In addition to that, a simple version of markdown is supported:
        ```
        `     escape other markdown
        ``    monospace and escape other markdown

        *     bold
        **    italic
        ***   bold with a red bg

        __    italic
        ___   underscore

        ~~    strikethrough

        $     xx-large
        $$    x-large
        $$$   large

        -------------------------------------

        For example, *bold*, and $$extra large$$, and ``monospaced``, and
        ***this __one__ is nested***, etc...
        ```

    * File paths and web links are supported:
        ```
        https://www.google.com
        www.google.com

        /home/user/Documents
        ~/Documents
        ~/Documents/img.png
        ~/Documents/file\ with\ spaces.png
        ```

---

### Todo.txt extensions

This extension supports the following todo.txt extensions:

<table>
    <tr>
        <td valign="top"><code>tracker_id:string</code></td>
        <td>
            Used to identify a task when starting/stopping
            the time-tracker via the dbus cli or using pomodoro.<br>
            Multiple tasks can have the same tracker_id.
        </td>
    </tr>
    <tr>
        <td valign="top"><code>pri:A-Z</code></td>
        <td>
            Used to restore the priority of a completed task when it gets reopend.
        </td>
    </tr>
    <tr>
        <td valign="top"><code>h:1</code></td>
        <td>
            Hides a task.<br><br>
            <b>This extension disables all other extensions.</b><br><br>
            <i>Among other things, can be used to populate the todo manager<br>
            with context/project keywords for autocompletion.<br>
            </i>
        </td>
    </tr>
    <tr>
        <td valign="top"><code>(t|defer):yyyy-mm-dd</code></td>
        <td>
            Defers opening a task until specified date.<br>
        </td>
    </tr>
    <tr>
        <td valign="top"><code>due|DUE:yyyy-mm-dd</code></td>
        <td>
            Sets a due date on a task.<br>
            <i>
            Timepp will also show how many days until/since the due date as well
as<br>
            provide the ability to sort tasks by due date.
            </i>
        </td>
    </tr>
    <tr>
        <td valign="top"><code>rec:recurrence_string</code></td>
        <td>
            Used to automatically reopen a task after a given amount of
time.<br><br>
            <b>This extension is incompatible with the due and defer extensions.</b><br><br>
            <i>Each time a task recurs, it's creation date is updated.<br>
            If a task is already open on the date of the recursion, it's
creation date will be updated anyway.</i><br><br>
            The <i>recurrence_string</i> can be in one of 3 diff forms:<br>
            <i>&nbsp;&nbsp&nbsp;&nbsp;(n=natural number, d=days, w=weeks,
m=months)</i><br><br>
            <ol>
            <li>
            <code>rec:n(d|w)</code><br>
                This means that the task will recur n days/weeks after the
creation date.<br>
                <i>- This rec type requires a creation date.</i><br>
                Examples:<br>
                <ul>
                <li>
                <code>x 2000-01-01 2000-01-01 rec:12d</code> means that the task
will reopen<br>
every 12 days starting from <code>2000-01-01</code>. After 12 days it will
look like<br>
                <code>2000-01-13 rec:12d</code>, and 12 days after that it will
look like<br>
                <code>2000-01-25 rec:12d</code>, and so on...
                </li>
                </ul>
            </li><br>
            <li>
                <code>rec:x-n(d|w)</code><br>
                This means that the task will recur n days/weeks after the
completion date.<br>
                <i>- This rec type requires a completion date if the task is
complete.</i><br>
                Examples:<br>
                <ul>
                <li><code>x 2000-01-01 rec:x-12d</code> recurs 12 days after
<code>2000-01-01</code>.</li>
                <li><code>(A) rec:x-3w</code> recurs 3 weeks after completion
date.</li>
                </ul>
            </li><br>
            <li>
                <code>rec:nd-nm</code><br>
                This means that the task will recur on the n-th day of every
n-th month starting<br>
                from the month of creation.<br>
                <i>- This rec type requires a creation date.</i><br>
                <i>- 'Month of creation' here refers to the month written into
the todo.txt file.<br>
                - If a month doesn't have the particular n-th day, the last day
of
that month will be used instead.</i><br>
                Examples:<br>
                <ul>
                <li><code>(A) 2000-01-01 rec:12d-1m</code> recurs on the 12th
day of each
month.</li>
                <li><code>(A) 2000-01-01 rec:1d-1m</code> recurs on the first
day of each
month.</li>
                <li><code>(A) 2000-01-01 rec:31d-1m</code> recurs on the last
day of each
month.</li>
                <li><code>(A) 2000-01-01 rec:64d-1m</code> also recurs on the
last day of each
month.</li>
                <li><code>(A) 2000-01-01 rec:29d-1m</code> recurs on the 29th
day of each
month, and in<br>
                the case of February, on the 28th if it doesn't have 29
days.</li>
                <li><code>(A) 2000-02-02 rec:12d-2m</code> recurs on the 12th
day every 2 months starting from February.<br>
                If the actual current date is <code>2000-02-08</code>, the task
recurs on <code>2000-02-12</code>.<br>
                If the actual current date is <code>2000-02-16</code>, the task
recurs on <code>2000-04-12</code>.<br>
                <li><code>(A) 2000-01-01 rec:1d-12m</code> recurs on the first
day of every year.</li>
                <li><code>(A) 2000-02-01 rec:29d-24m</code> recurs on the last
day of February every 2 years starting from 2000.</li>
                </ul>
            </li>
            </ol>
        </td>
    </tr>
</table>

---

### Time Tracker

The time tracker is built into the todo.txt manager and allows you to track the
time spent on a particular task as well as the time spent on a particular
project.  

> This extension features a fullscreen stats view for browsing your time-tracker data
> * The stats view has a cool looking vbars graph for displaying data
> * It supports viewing time spent on tasks/projects on any recorded day
> * You can see a detailed view for a particular task/project
> * You can fuzzy search your history
> * You can view the most worked on tasks/projects in a particular time interval

When pressing the play button to track a task, all projects associated with that
task will also be tracked.

At the start of each year, the current yearly csv file will be archived and a 
new file will be started.

There is also a daily csv file which gets appended to the yearly file at the 
start of each day.

> **NOTE:**  
> When editing a task that has been time-tracked, only the corresponding entry
in the daily csv file will be updated. The yearly csv file will not be changed.

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
```

---

### DBus API

This extension comes with a dbus api. Check out the [dbus dir](dbus) for info on
what you can do.

There are also some example scripts that might come in handy. :smile:

---

### Custom Theme Support

This extension supports custom themes. In order to style it, place a
`timepp.css` file into your theme's root directory _(the dir where the
`gnome-shell.css` file is)_.

You must use the `!important` directive in order to override a property from the
extensions' stylesheet.

---

### Preview

<b><sub> [Gnome-Shell theme](https://github.com/zagortenay333/ciliora-tertia-shell), [Wallpaper](https://i.imgur.com/raHVKVk.jpg)</sub></b>

![preview](https://i.imgur.com/FYQ0RM2.png)
