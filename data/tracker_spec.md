### Dir structure

When a directory for the time tracker has been chosen, timepp will automatically
create the following structure inside of it:

```
├── 2018__time_tracker.csv       (yearly csv file)
├── TODAY__time_tracker.csv      (daily csv file)
└── YEARS__time_tracker          (dir containing prev yearly csv files)
    └── 2017__time_tracker.csv
    └── 2016__time_tracker.csv
    └── 2015__time_tracker.csv
     .
     .
     .
```

* The current yearly csv file eventually gets automatically moved into the
`YEARS__time_tracker` dir.

* The daily csv file eventually gets automatically appended to the yearly csv
file.

---

### Tracker csv specification

All csv files have the same structure.

A single line in the csv file is of the form:

```csv
date, total time, type, task or project, intervals (optional)
```

* **date** is in iso format: `yyyy-mm-dd` (e.g., 2000-01-01).

* **total time** is in 24-clock format `hh:mm:ss` or (for backwards
compatibility) `hh:mm`.

* **type** is either `()` or `++`, where `()` means task and `++` means project.

* **task/project** is a task entry or a project keyword inside double quotes.
Quotes inside are escaped by preceding them with another double quote (RFC
4180).

* **intervals** is a sequence of intervals joined by double vert bars `||`:
interval||interval||...||interval
    * **interval** is of the form `hh:mm:ss..hh:mm:ss` (`start..stop`).
    * If **intervals** ends with a double dot `..`, then the last interval is
'open' (either currently running or was abruptly canceled).


Example:

```csv
2017-02-04, 08:03:29, ++, "+my_project", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-04, 23:59:33, ++, "+protect_gotham", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-04, 02:03:56, ++, "+protect_gotham", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-04, 02:03:32, (), "(A) Watch the world burn.", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-04, 02:03:03, (), "(A) Catch Joker.", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-04, 02:03:34, (), "(Z) Take the trash out.", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 08:03:34, ++, "+my_project", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 23:59:34, ++, "+protect_gotham", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 02:03:12, ++, "+protect_gotham", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 02:03:21, (), "(A) Watch the world burn.", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 02:03:45, (), "x 2017-02-05 Catch Joker.", 12:34:34..12:45:45||15:34:11..16:34:34
2017-02-05, 02:03:34, (), "(Z) Take the trash out.", 12:34:34..12:45:45||15:34:11..16:34:34
```
