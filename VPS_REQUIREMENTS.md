# VPS Requirements for MyBazaar OTP Integration

## Level 1: Essential Requirements (Must Have)

### Network & Access
- [ ] Fixed public IPv4 address
  - This is the core requirement for 360 SMS whitelist
- [ ] SSH access enabled (port 22)
  - Required for server configuration and deployment
- [ ] HTTP/HTTPS ports open (80, 443)
  - For web services and API access
- [ ] Unrestricted outbound network access
  - Must be able to reach 360 SMS API (https://sms.360.my)
  - No IP whitelist/blacklist restrictions
- [ ] Root or sudo privileges
  - Required for software installation and configuration

---

## Level 2: Runtime Environment (Choose at least one)

### Option A: Full Web Environment (Recommended)
```
For running WordPress + OTP forwarding service

Required:
  ☑ PHP 7.4+ or PHP 8.0+
    └─ Running WordPress single-page site
  
  ☑ MySQL 5.7+ or MariaDB
    └─ WordPress database
  
  ☑ Node.js 14+ or Python 3.7+
    └─ Running OTP forwarding service
  
  ☑ Nginx or Apache
    └─ Web server
```

### Option B: Minimal Environment
```
If not running WordPress

Required:
  ☑ Node.js 14+ 
    OR Python 3.7+
    └─ For OTP forwarding service only
```

---

## Level 3: System Specifications

### Recommended OS
- [ ] Ubuntu 20.04 LTS
- [ ] Ubuntu 22.04 LTS
- [ ] CentOS 7 or higher
- [ ] Debian 11 or higher

### Minimum Hardware Specs
- [ ] RAM: at least 1GB
- [ ] Disk Space: at least 20GB
- [ ] CPU: 1 core minimum (2+ recommended)

### Backup & Support
- [ ] Automatic backup functionality (recommended)
- [ ] 24/7 support available

---

## Level 4: Questions to Ask Your VPS Provider

Before purchasing/confirming your VPS, ask the provider:

```
1. Does the VPS come with a fixed public IPv4 address?

2. What is the operating system and version?
   (Ubuntu 20.04? CentOS 7? etc.)

3. Are SSH access (port 22) and root/sudo available?

4. Are HTTP (80) and HTTPS (443) ports open?

5. Are there any restrictions on outbound network 
   connections? Can I reach external APIs?

6. What software is pre-installed?
   - PHP version?
   - MySQL/MariaDB version?
   - Node.js available?
   - Python version?

7. Do you provide automatic backups?

8. What is your uptime SLA guarantee?

9. Can I install custom software (Node.js, Python packages)?

10. What is the monthly bandwidth limit?
```

---

## Deployment Architecture

Once VPS is confirmed, the setup will be:

```
┌─────────────────────────────────────────┐
│      Cloud Functions (Firebase)         │
│     (MyBazaar OTP Service)              │
└──────────────┬──────────────────────────┘
               │ sends OTP request
               ↓
┌─────────────────────────────────────────┐
│    VPS with Fixed Public IP             │
│  ┌─────────────────────────────────┐   │
│  │ WordPress (single-page site)    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ OTP Forwarding Service          │   │
│  │ (Node.js/Python script)         │   │
│  │ Listens on: 0.0.0.0:3000/otp    │   │
│  └─────────────────────────────────┘   │
└──────────────┬──────────────────────────┘
               │ forwards OTP request
               ↓
┌─────────────────────────────────────────┐
│   360 SMS API (sms.360.my)              │
│   WhiteList IP: [VPS_PUBLIC_IP]         │
└─────────────────────────────────────────┘
```

---

## Integration Flow

1. **Cloud Function** sends OTP request to VPS
   - `POST http://[VPS_IP]:3000/otp`
   - Includes: phone number, message, etc.

2. **VPS OTP Service** validates and forwards to 360
   - Receives request from Cloud Function
   - Forwards to 360 SMS API
   - 360 sees request coming from VPS IP ✓

3. **360 SMS API** processes the request
   - Validates VPS IP against whitelist
   - Sends SMS to Malaysian phone number
   - Returns success/failure status

4. **VPS forwards response** back to Cloud Function
   - Returns delivery confirmation
   - Cloud Function receives result

---

## Security Considerations

### Already Implemented
- IP whitelist on 360 SMS (VPS IP only)
- API key validation

### Additional Recommended (Optional)
- [ ] Use HTTPS for VPS communication
- [ ] Implement API key authentication in OTP service
- [ ] Rate limiting on OTP endpoint
- [ ] Logging and monitoring

---

## Pre-Purchase Checklist

Before confirming the VPS, verify:

```
Network:
☑ Fixed public IPv4 address
☑ SSH, HTTP, HTTPS ports open
☑ Unrestricted outbound access

Environment:
☑ Suitable operating system
☑ Node.js or Python available
☑ (Optional) PHP + MySQL if running WordPress

Access:
☑ Root or sudo privileges
☑ Easy to manage and configure
☑ Good provider support

Cost:
☑ Budget-friendly (~RM11/month)
☑ No surprise fees
☑ Clear renewal pricing
```

---

## Next Steps

Once VPS is confirmed and accessible, provide:
1. VPS IP address
2. SSH credentials (if needed)
3. OS details
4. Pre-installed software list

Then we will:
- [ ] Deploy WordPress
- [ ] Set up OTP forwarding service
- [ ] Configure 360 SMS whitelist
- [ ] Test the complete flow
