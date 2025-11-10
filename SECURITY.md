# Security Policy

## Supported Versions

Only the latest version of youBencha receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Report via [GitHub Security Advisories](https://github.com/youbencha/youbencha-cli/security/advisories)
3. Or email: security@youbencha.dev
4. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

**Response Time:**
- Initial response: Within 48 hours
- Status update: Within 7 days
- Fix timeline: Depends on severity

## Security Considerations

### Known Security Model

youBencha executes AI agents with file system access. This is intentional but requires caution:

- **Agents can read/write files** in the workspace directory
- **Suite configurations can execute code** via agent prompts
- **Git operations** clone remote repositories

### Best Practices

1. **Only run trusted configurations**
2. **Use isolated environments** (containers, VMs) for untrusted code
3. **Review agent outputs** before applying to production
4. **Keep dependencies updated**: `npm audit fix`
5. **Use specific commit SHAs** instead of branches when possible

### Out of Scope

The following are outside our security scope:

- Vulnerabilities in the AI models themselves
- Malicious behavior by properly authenticated agents
- Social engineering attacks
- DoS via legitimate heavy workloads

## Disclosure Policy

- Vulnerability details disclosed 90 days after fix
- Critical vulnerabilities disclosed after all users have reasonable time to upgrade
- Credit given to reporters (unless anonymous)
