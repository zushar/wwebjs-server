# This Dockerfile is used to build a Docker image for the browser pool service.
FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app
USER root
# Install necessary tools including socat
RUN apt-get update && apt-get install -y net-tools curl netcat-openbsd socat && rm -rf /var/lib/apt/lists/*
USER pptruser

COPY --chmod=755 start-chrome.sh /app/
EXPOSE 9222
EXPOSE 9223

CMD ["/app/start-chrome.sh"]
