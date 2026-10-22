👑 Queen
========

A beautiful agentic way to garner insights from your Bee Wearable or Bee App.
Based on and pulls the latest ``bee-cli``. Originally built for the Amazon Developer Hackathon c.2026.

.. image:: items/tui.png
   :alt: Queen TUI
   :align: center
   :width: 100%

Dependencies
------------

``bee-cli`` is pinned by the parent commit. ``elthur`` is my GGUF inference package and is kept on the latest commit.
**All upstream changes are propagated** this ensures the latest versions of both, while maintenance is a clear separation of concerns. 
``main`` by the build (``git submodule update --remote``); to freeze a release, build with ``QUEEN_NO_ELTHUR_UPDATE=1`` and commit the resulting gitlink. 
Both revisions are baked into the binary at build time and shown by ``queen status``.

Notes
------
Parts of the codebase have been AI generated. Nearly all generated code is reviewed by me and there are also comprehensive unit tests in order to mitigate any breakages.
None of the text or the submission to the actual hackathon entry is AI generated.


Run TUI
--------
The TUI for ``MacOS`` only is shipped in Releases. Download and place it in ``usr/local/bin`` or any other folder.
Then run like you would any other executable. It is codesigned with my Apple Developer Id, though MacOS verification takes some time on first launch.


.. code-block:: bash

   chmod +x ./queen
   ./queen

Run CLI
--------

While a bare ``queen`` opens the TUI. Any argument — or piped stdin — runs a single command, prints one card, and exits.
Plain text commands are agent interpreted (locally) and keywords commands execute the same way as they would in Bee CLI.

.. code-block:: bash

   ./tui/dist/queen status
   ./tui/dist/queen todos create --text "buy milk"
   ./tui/dist/queen "show latest todo"
   echo "what did I say about the budget" | ./tui/dist/queen

Recognized subcommands are derived from the pinned ``bee-cli`` registry, so every resource (``todos``, ``facts``, ``insights``, ``journals``, ``conversations``,
``locations``, ``search``, …) works. Free text is resolved cheaply: information questions go to Bee search, list/latest reads are deterministic, and actions use
one local-model tool-selection turn. Ambiguous requests fail fast with a card of runnable suggestions instead of guessing.

First launch is slow
--------------------

The model is embedded in the executable, so macOS verifies the entire signed
file. Subsequent launches will be way faster.

Credentials
-----------

Tokens are stored as dotfiles under ``~/.bee/`` (``token-<env>``, mode 0600) rather than the macOS Keychain. The binary is re-signed on every build, so the
Keychain would prompt for your login password on each launch.
