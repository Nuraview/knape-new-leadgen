FROM alpine:3.20
RUN apk add --no-cache ffmpeg python3 curl \
  && ARCH=$(uname -m) && case "$ARCH" in x86_64) A=amd64 ;; aarch64) A=arm64 ;; *) A=amd64 ;; esac \
  && curl -fsSL "https://dl.min.io/client/mc/release/linux-${A}/mc" -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc
COPY server.py /server.py
COPY badge.png /badge.png
EXPOSE 8080
CMD ["python3", "/server.py"]
