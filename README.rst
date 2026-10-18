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

.. code-block:: bash

   ./build_all.sh                              # queen
   ./build.sh --list

``./build_all.sh`` builds the queen executable with the LFM2.5-2.6B model:

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

Credentials
-----------

Tokens are stored as dotfiles under ``~/.bee/`` (``token-<env>``, mode 0600)
rather than the macOS Keychain. The binary is re-signed on every build, so the
Keychain would prompt for your login password on each launch. Set
``BEE_FORCE_FILE_STORE=0`` to use the Keychain instead.
