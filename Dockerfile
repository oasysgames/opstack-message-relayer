# Build Geth in a stock Go builder container
FROM node:alpine3.19
WORKDIR /app

# Support setting various labels on the final image
ARG COMMIT=""
ARG VERSION=""
ARG BUILDNUM=""

# automatically set by buildkit, can be changed with --platform flag
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT

COPY . .

RUN npm install -g pnpm@8.10.3 &&\
    pnpm install

CMD [ "pnpm start" ]

LABEL commit="$COMMIT" version="$VERSION" buildnum="$BUILDNUM"