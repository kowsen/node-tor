Kyle Owsen - 1166578 - owsenk@uw.edu

Early on in the project, I was in a group with Cooper Clauson, but our implementations diverged so much in the early stages that we decided to split up.

Since there don't seem to be any other routers up that are fully working, I haven't been able to test very much with other implementations, but I thought it would be better to submit it now anyways, and try to change it later if something comes up.

If you want to only connect to routers with the same team ID as the one you create, just add a fourth argument after the HTTP Proxy port (doesn't matter what it is) and it'll only fetch routers beginning with its group number.

If you want to print more debugging information, you can change the "-c" value in run to "-t" to log all tor messages, "-h" to log all HTTP messages, or "-a" to log all messages.

I don't know if either of these things will make your life easier, but I thought I'd include them just in case!

--------------------------------------------

Also, just a note - I started agent 0x04558888 today (3/10) around 2pm, and don't intend on reopening it if it closes. If you can still connect to its proxy at attu1.cs.washington.edu on port 1138, that means its been up and running since then. 0x0455333 has been running for about a day longer and 0x04558888 routes through it, but I misplaced its proxy port. You can tell it's not just the old proxy because your public facing IP belongs to attu4, not attu1. I understand if you can't just take my word on that though when it comes to grading reliability.