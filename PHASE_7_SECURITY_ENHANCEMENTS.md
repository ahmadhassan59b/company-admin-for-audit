# Phase 7: Security Enhancements

## Overview

Phase 7 focuses on securing the system against unauthorized access, malicious activity, and common application vulnerabilities.

The goal is to improve encryption, authentication, authorization, and auditability without breaking the current product flow.

---

## 1. Encrypt Sensitive Data

Sensitive tokens are encrypted at rest and the app continues to rely on TLS in transit.

### What is covered

- HubSpot access tokens and refresh tokens are encrypted before storage
- Passwords are hashed with PBKDF2
- Production deployment should continue to use HTTPS/TLS

---

## 2. Two-Factor Authentication

Add optional TOTP-based 2FA for user accounts.

### What is covered

- Generate a per-user secret
- Store the secret encrypted at rest
- Verify one-time codes during login
- Allow enabling and disabling 2FA through authenticated endpoints

---

## 3. Role-Based Access Control

Add user roles and admin-only routes for security operations.

### What is covered

- Users now have a role field
- Admin-only endpoints are protected with RBAC middleware
- Security events and user-role administration are available through protected APIs

---

## 4. API Security

Keep APIs protected with JWT auth, rate limiting, CORS, Helmet, and role checks.

### What is covered

- JWT authentication
- Rate limiting on auth and API routes
- CORS allowlist
- Helmet headers
- Role-gated admin routes

---

## 5. Penetration Testing

This phase does not automate pentesting, but it adds the foundation for easier security review.

### What is covered

- Better audit logs
- Admin visibility into security events
- Harder-to-bypass auth and role controls

---

## 6. Security Patches and Updates

Dependency updates remain a separate operational task.

### What is covered

- Build and version endpoints
- Clear runtime visibility for deployed services

---

## 7. Data Auditing and Logging

Track critical authentication and account-change events.

### What is covered

- Login success and failure
- 2FA setup, enable, and disable
- HubSpot connection and account actions
- Admin access to security events

