# Proxy to the legacy Next app (nuraview-crm, :3005).
#
# Included by every crmx1 location that is NOT ported to the new stack yet.
# Kept as one file so the day a path moves across, it is a one-line change in
# crmx1.nuraview.com.conf and not a copy-paste hunt through twelve blocks.
#
# Long timeouts because the proposal PDF path drives headless Chromium.
proxy_cache off;
proxy_no_cache 1;
proxy_pass http://127.0.0.1:3005;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
