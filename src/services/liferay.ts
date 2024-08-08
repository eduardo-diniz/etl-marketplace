import ky from "ky";

import Cache from "../utils/cache";
import { liferayAuthSchema } from "../schemas/zod";
import { ENV } from "../config/env";

const {
    LIFERAY_HOST,
    LIFERAY_CLIENT_ID,
    LIFERAY_CLIENT_SECRET,
    LIFERAY_PASSWORD,
    LIFERAY_USERNAME,
} = liferayAuthSchema.parse(ENV);

const isBasicAuth = LIFERAY_USERNAME && LIFERAY_PASSWORD;

const liferay = ky.extend({
    prefixUrl: LIFERAY_HOST,
});

const cache = Cache.getInstance();

export default liferay.extend({
    headers: {
        Authorization: isBasicAuth
            ? `Basic ${btoa(`${LIFERAY_USERNAME}:${LIFERAY_PASSWORD}`)}`
            : "",
    },
    hooks: {
        beforeRequest: [
            (request) => {
                const authorization = cache.get("authorization");

                if (authorization) {
                    request.headers.set("Authorization", authorization);
                }
            },
        ],
        beforeRetry: [
            async ({ request, error, retryCount }) => {
                console.log({ request, retryCount, error });

                if (
                    isBasicAuth ||
                    !LIFERAY_CLIENT_ID ||
                    !LIFERAY_CLIENT_SECRET
                ) {
                    return;
                }

                const isExpired = cache.has("expires_in")
                    ? Date.now() < cache.get("expires_in")
                    : false;

                if (!request.headers.get("Authorization") || isExpired) {
                    const searchParams = new URLSearchParams();

                    searchParams.set("client_id", LIFERAY_CLIENT_ID);
                    searchParams.set("client_secret", LIFERAY_CLIENT_SECRET);
                    searchParams.set("grant_type", "client_credentials");

                    const response = await liferay.post("o/oauth2/token", {
                        body: searchParams,
                    });

                    const data = await response.json<any>();

                    const authorization = `${data.token_type} ${data.access_token}`;

                    cache.set(
                        "expires_in",
                        data.expires_in * 1000 + Date.now()
                    );
                    cache.set("authorization", authorization);

                    return request.headers.set("Authorization", authorization);
                }
            },
        ],
    },
    retry: {
        limit: 5,
        methods: ["get", "post"],
        statusCodes: [403, 401],
        backoffLimit: 3000,
    },
});
