FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

RUN mkdir -p /var/www/certbot /etc/letsencrypt/live/vertex

COPY nginx.conf /etc/nginx/nginx.conf
COPY ssl-init.sh /docker-entrypoint.d/40-ssl-init.sh
COPY reload-watcher.sh /usr/local/bin/reload-watcher.sh
COPY entrypoint-nginx.sh /entrypoint-nginx.sh

RUN chmod +x /docker-entrypoint.d/40-ssl-init.sh \
    /usr/local/bin/reload-watcher.sh \
    /entrypoint-nginx.sh

EXPOSE 80 443

CMD ["/entrypoint-nginx.sh"]
