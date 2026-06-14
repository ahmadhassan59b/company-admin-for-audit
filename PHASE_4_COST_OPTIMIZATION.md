# Phase 4: Cost Optimization

## Overview

This phase focuses on reducing costs associated with AI usage, optimizing the system, and ensuring the efficient handling of AI requests through caching and tracking.

The objective is to decrease API calls and optimize resources, improving overall system efficiency.

---

## 1. Snapshot Compression

AI snapshots are compressed before storing them in the AI cache.

### Objective

Reduce storage usage by storing AI cache payloads in a compressed format.

---

## 2. Reduce AI Token Usage

AI calls are minimized by caching and skipping unnecessary requests.

### Objective

Ensure AI calls are only made when they are actually needed.

---

## 3. Add Caching Layer

The app uses a cache layer to avoid repeated AI requests for the same audit facts.

### Objective

Avoid hitting the API or database for every request by using cached AI results.

---

## 4. Track Cost Per Audit

Each audit can store cost metadata in a dedicated table.

### Objective

Monitor estimated AI usage cost per audit and keep track of savings from cache hits.

---

## 5. Verify the Caching and Cost Optimization

Repeated audits should reuse cached results when possible.

### Objective

Confirm that caching works and that cost tracking captures savings.

---

## What is intentionally skipped

- Model switching
- Multi-model routing
- Advanced compression beyond cache payloads

---

## Next Phase

Phase 5 can focus on further optimization or new product features after Phase 4 is verified.
