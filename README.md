# Cistern

A local-first personal finance tracker for the desktop. Cistern keeps your money data on your own machine, encrypted with a passphrase, and helps you plan spending around a survival floor instead of just recording it.

> Cistern is a personal project under active development. Expect rough edges.

## Why it exists

Most finance apps log what happened. Cistern tries to answer the questions that matter before you spend: *Can I afford this? Will this cycle end in the red? Is this money actually free?*

## Features

- **Cycle-based tracking:** income, expenses and buckets organised by budgeting cycle, with an intention-vs-reality score for each closed cycle.
- **Survival floor and Floor Radar:** shows how close your spendable balance is to the minimum you need, with an end-of-cycle projection at your current pace.
- **Planning Environment:** a what-if cash-flow simulator that is separate from your real transactions. It supports scenarios, comparisons, breach detection and suggested cuts.
- **Sealed Reserves and Emergency Fund:** money you deliberately lock away. It's excluded from spendable balance, and unsealing or spending from the emergency fund needs your passphrase.
- **Savings targets:** contributions are real transactions, plus a suggested allocation of surplus across targets by remaining amount and deadline.
- **Loans:** a feasibility check before you borrow, automatic repayment skimming from income, and manual extra repayments.
- **Nudges:** anomaly detection for unusual transactions and fast-running buckets, plus alerts for recurring spend that looks like it's no longer worth it.
- **Jarvis (optional):** a local AI assistant running on [Ollama](https://ollama.com). The model never does arithmetic itself. Deterministic Rust and SQL code computes the numbers, and the model only explains them.

## Privacy and security

- All data stays in a local SQLite database on your machine. Nothing is uploaded and there are no accounts.
- The database is encrypted with SQLCipher (AES-256). The key is derived from your passphrase with Argon2id and is never stored.
- There is a one-time recovery key. If you lose both your passphrase and the recovery key, your data cannot be recovered.
- The AI features talk only to a local Ollama server (`localhost:11434`).
- This repository contains source code only. It contains no user data.

## Tech stack

Tauri v2, React, TypeScript, Rust, SQLite (SQLCipher), Recharts, Tailwind CSS.

## Getting started

Prerequisites: [Node.js](https://nodejs.org), the [Rust toolchain](https://rustup.rs), the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS, and OpenSSL (required to build SQLCipher; set `OPENSSL_DIR` if the build can't find it). Ollama is only needed for Jarvis.

```bash
git clone https://github.com/kandaalasricharan3-cell/Cistern.git
cd Cistern
npm install
npm run tauri dev
```

To build installers:

```bash
npm run tauri build
```

On first launch you'll create a passphrase and receive a recovery key. Store it somewhere safe.

## Screenshots

_Coming soon. Screenshots will use sample data only._

## Status

Active development. The core tracking, planning, reserves, loans and Jarvis assistant work. A mobile companion is planned.

## License

No license has been chosen yet, so all rights are reserved by default. Add a `LICENSE` file if you want others to reuse the code.
