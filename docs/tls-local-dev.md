# HTTPS in local development (SEC-09)

Browsers only expose `navigator.mediaDevices.getUserMedia` in a **secure
context**. `http://localhost` counts as secure; `http://192.168.1.x:3000` or any
other plain-HTTP origin does not. Testing the voice portal from a phone, a
second machine, or a LAN address therefore requires TLS even when everything
runs on your desk.

The production stack terminates TLS in `docker/nginx/tls.conf.template`. This
document covers practising that setup locally with a self-signed CA, and how to
swap in public certificates later.

---

## 1. Create a local certificate authority with mkcert

```bash
# https://github.com/FiloSottile/mkcert
mkcert -install                       # trusts the local CA in your browsers
mkdir -p certs
mkcert -cert-file certs/fullchain.pem -key-file certs/privkey.pem \
  voice.localhost admin.localhost api.localhost localhost 127.0.0.1
```

`mkcert -install` is what stops the browser from treating the result as an
untrusted certificate. Without it the pages load but the microphone prompt may
still be refused, because the certificate warning page is not a secure context.

## 2. Point the hostnames at your machine

Add to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows,
`/etc/hosts` elsewhere):

```
127.0.0.1 voice.localhost admin.localhost api.localhost
```

`*.localhost` usually resolves already; the explicit entries make it reliable
when testing from another device on the LAN (replace `127.0.0.1` with the host's
LAN address in that case, and re-issue the certificate for that IP).

## 3. Configure `.env`

```dotenv
TLS_CONSUMER_HOST=voice.localhost
TLS_ADMIN_HOST=admin.localhost
TLS_API_HOST=api.localhost

ADMIN_CORS_ORIGINS=https://admin.localhost
CONSUMER_CORS_ORIGINS=https://voice.localhost

TRUSTED_PROXY_IPS=172.16.0.0/12
```

`VITE_API_BASE_URL` is compiled into the UI bundles at build time, so the UIs
must be rebuilt whenever `TLS_API_HOST` changes.

## 4. Run the stack with the TLS overlay

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Open <https://voice.localhost> and <https://admin.localhost>. The API answers on
<https://api.localhost/health>.

## 5. Verify

```bash
# TLS handshake and certificate chain
openssl s_client -connect voice.localhost:443 -servername voice.localhost </dev/null | head -n 20

# Redirect from plain HTTP
curl -sSI http://voice.localhost/ | head -n 5           # expect 308 → https

# HSTS is present on every response, including proxied assets
curl -sSI https://voice.localhost/ | grep -i strict-transport-security

# The CSP allows the TLS API and signalling origin
curl -sSI https://voice.localhost/ | grep -i content-security-policy

# Rate limiting still keys on the real client, not the proxy
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.localhost/api/v1/voice/offer \
  -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.7' \
  -d '{"sdp":"v=0\r\n","type":"offer"}'
# Repeat 5 times: the 6th returns 429 for that forwarded address only.
```

If every request shares one bucket, `TRUSTED_PROXY_IPS` is missing or does not
cover the proxy address — the gateway deliberately ignores `X-Forwarded-For`
from untrusted peers.

---

## Public certificates (Let's Encrypt)

`tls.conf.template` keeps `/.well-known/acme-challenge/` on port 80 so HTTP-01
validation works while 443 serves TLS.

```bash
# .env: TLS_CERT_FILE=/etc/nginx/certs/fullchain.pem (the default)
docker run --rm -v "$PWD/certbot-webroot:/var/www/certbot" \
  -v "$PWD/certs:/etc/letsencrypt" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d voice.example.com -d admin.example.com -d api.example.com \
  --email ops@example.com --agree-tos --non-interactive

cp certs/live/voice.example.com/fullchain.pem certs/fullchain.pem
cp certs/live/voice.example.com/privkey.pem    certs/privkey.pem
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec tls nginx -s reload
```

Renewal on the same schedule (twice daily, `certbot renew`) followed by the
`nginx -s reload` above keeps the served chain current.

---

## Notes and limits

- The UIs' own nginx configs still target `http://localhost:8000` in their CSP.
  The TLS proxy replaces that header (`proxy_hide_header Content-Security-Policy`
  plus its own `add_header`), so only the proxy needs updating when hostnames
  change.
- Ports 8000/3000/5173 stay bound to the host loopback. Do not publish them on a
  public interface; the proxy is the only fan-in and the CSP depends on it.
- The API enforces HTTPS only by being unreachable over plain HTTP from outside
  the host. There is no HSTS preload entry and no `upgrade-insecure-requests`
  directive, so mixed-content mistakes show up as console errors rather than
  being silently rewritten.
- Media (WebRTC audio) does not traverse the proxy; only signalling does. ICE
  candidates advertise the gateway's addresses, so a NATed deployment still needs
  reachable RTP ports or a TURN server.
