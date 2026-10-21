👑 Queen
========

A beautiful agentic way to garner insights from your Bee Wearable or Bee App.
Based on and pulls the latest ``bee-cli``.

First launch is slow
--------------------

The model is embedded in the executable, so macOS verifies the entire signed
file. Subsequent launches will be way faster.

Build
-----

Requires Bun >= 1.3.0. The elthur dylib comes from the ``elthur/`` submodule
(``elthur/outputs/lib/libelthur.dylib``); the build keeps it on latest ``main``
(disable with ``QUEEN_NO_ELTHUR_UPDATE=1``). On a fresh clone, initialize
submodules first:

.. code-block:: bash

   git submodule update --init --recursive

The elthur dylib is built with ``zig build dylib``. It is a pure engine and
needs no GGUF at compile time; the model enters only when the build appends it
to the executable. Rebuilding the engine therefore never requires a model
download.

.. code-block:: bash

   ./scripts/build_all.sh                      # queen
   ./scripts/build.sh --list

``./scripts/build_all.sh`` builds the queen executable with the LFM2.5-2.6B model:

+----------------------+--------------------+------------------+
| artifact             | model              | notes            |
+======================+====================+==================+
| ``dist/queen``       | LFM2.5-2.6B Q5_K_M  | default build    |
+----------------------+--------------------+------------------+

``queen`` bakes the model into the executable. Pass ``-m qwen3.5 -p 4b -q
q5_k_m`` to build the Qwen3.5-4B alternative instead.

Dependencies
------------

``bee-cli`` is pinned by the parent commit. ``elthur`` is kept on latest
``main`` by the build (``git submodule update --remote``); to freeze a release,
build with ``QUEEN_NO_ELTHUR_UPDATE=1`` and commit the resulting gitlink. Both
revisions are baked into the binary at build time and shown by ``/status``.

Run
---

.. code-block:: bash

   ./tui/dist/queen

One-shot CLI
------------

A bare ``queen`` opens the TUI. Any argument — or piped stdin — runs a single
command, prints one card, and exits:

.. code-block:: bash

   ./tui/dist/queen status
   ./tui/dist/queen todos create --text "buy milk"
   ./tui/dist/queen "show latest todo"
   echo "what did I say about the budget" | ./tui/dist/queen

Recognized subcommands are derived from the pinned ``bee-cli`` registry, so every
resource (``todos``, ``facts``, ``insights``, ``journals``, ``conversations``,
``locations``, ``search``, …) works. Free text is resolved cheaply: information
questions go to Bee search, list/latest reads are deterministic, and actions use
one local-model tool-selection turn. Ambiguous requests fail fast with a card of
runnable suggestions instead of guessing.

Credentials
-----------

Tokens are stored as dotfiles under ``~/.bee/`` (``token-<env>``, mode 0600)
rather than the macOS Keychain. The binary is re-signed on every build, so the
Keychain would prompt for your login password on each launch. Set
``BEE_FORCE_FILE_STORE=0`` to use the Keychain instead.
