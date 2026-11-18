import { createJiti } from "jiti";
import { pathToFileURL } from "node:url";

const jiti = createJiti(new URL("../package.json", import.meta.url).href, { interopDefault: true });
const { detachSharedProviderApiKeys } = await jiti.import("./lib/models-config-secrets.ts");
detachSharedProviderApiKeys();
console.log("models.json apiKey fields detached");
