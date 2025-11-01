import type { Loader, LoaderContext } from "astro/loaders";
import type { ZodSchema } from "zod";
import configData from "@util/themeConfig";

type TidbFieldConfig = {
  id?: string;
  title?: string;
  description?: string;
  tags?: string;
  icon?: string;
  image?: string;
  link?: string;
  featured?: string;
};

type TidbOptions = {
  table?: string;
  query?: string;
  fields?: TidbFieldConfig;
  tagSeparator?: string;
};

type TidbLoaderOptions = {
  schema: Loader["schema"] | ZodSchema | (() => ZodSchema);
};

const DEFAULT_FIELDS: Required<TidbFieldConfig> = {
  id: "id",
  title: "title",
  description: "description",
  tags: "tags",
  icon: "icon",
  image: "image",
  link: "link",
  featured: "featured",
};

function normaliseTags(value: unknown, separator: string) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === "string" ? tag.trim() : String(tag)))
      .filter((tag) => tag.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((tag) => (typeof tag === "string" ? tag.trim() : String(tag)))
          .filter((tag) => tag.length > 0);
      }
    } catch {
      // fall through to separator handling
    }

    const parts = trimmed
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    return parts.length > 0 ? parts : undefined;
  }

  return undefined;
}

async function getMysqlModule(logger: LoaderContext["logger"]) {
  try {
    return await import("mysql2/promise");
  } catch (error) {
    logger.warn(
      "mysql2 is not installed. Install it with `pnpm add mysql2` (or your package manager of choice) to enable the TiDB loader."
    );
    logger.warn(String(error));
    return null;
  }
}

function buildQuery(options: TidbOptions, fields: TidbFieldConfig) {
  if (options.query) {
    return options.query;
  }

  if (!options.table) {
    throw new Error(
      "You need to set either directoryData.source.tidb.query or directoryData.source.tidb.table in settings.toml"
    );
  }

  const columns = Array.from(
    new Set(
      Object.values(fields)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((value) => `\`${value}\``)
    )
  );

  if (columns.length === 0) {
    throw new Error("No columns available to build TiDB query");
  }

  return `SELECT ${columns.join(", ")} FROM \`${options.table}\``;
}

export function tidbLoader({ schema }: TidbLoaderOptions): Loader {
  const tidbOptions: TidbOptions | undefined = configData.directoryData?.source?.tidb;
  const tagSeparator = tidbOptions?.tagSeparator ?? ",";

  return {
    name: "tidb-loader",
    schema,
    load: async ({ logger, store }: LoaderContext) => {
      const host = import.meta.env.TIDB_HOST;
      const port = import.meta.env.TIDB_PORT;
      const user = import.meta.env.TIDB_USER;
      const password = import.meta.env.TIDB_PASSWORD;
      const database = import.meta.env.TIDB_DATABASE;
      const enableSsl = import.meta.env.TIDB_ENABLE_SSL;
      const rejectUnauthorized = import.meta.env.TIDB_SSL_REJECT_UNAUTHORIZED;
      const ca = import.meta.env.TIDB_SSL_CA;

      if (!host || !user || !password || !database) {
        logger.warn(
          "TiDB connection variables are missing. Please define TIDB_HOST, TIDB_USER, TIDB_PASSWORD, and TIDB_DATABASE to load data."
        );
        return;
      }

      const mysql = await getMysqlModule(logger);

      if (!mysql) {
        return;
      }

      const fields: TidbFieldConfig = {
        ...DEFAULT_FIELDS,
        ...tidbOptions?.fields,
      };

      if (!fields.id) {
        logger.error("directoryData.source.tidb.fields.id must be defined to generate entry ids.");
        return;
      }

      let query: string;
      try {
        query = buildQuery(tidbOptions ?? {}, fields);
      } catch (error) {
        logger.error(String(error));
        return;
      }

      const connectionOptions: Record<string, unknown> = {
        host,
        user,
        password,
        database,
      };

      if (port) {
        connectionOptions.port = Number(port);
      }

      if ((enableSsl ?? "true").toLowerCase() === "true") {
        connectionOptions.ssl = {
          rejectUnauthorized: (rejectUnauthorized ?? "true").toLowerCase() === "true",
          ca,
        };
      }

      let connection: any;

      try {
        connection = await mysql.createConnection(connectionOptions);
      } catch (error) {
        logger.error(`Unable to connect to TiDB: ${String(error)}`);
        return;
      }

      try {
        const [rows] = await connection.execute(query);

        if (!Array.isArray(rows)) {
          logger.warn("TiDB query did not return an array of rows.");
          return;
        }

        for (const row of rows as Record<string, unknown>[]) {
          const idValue = row[fields.id!];

          if (idValue === undefined || idValue === null) {
            continue;
          }

          const data: Record<string, unknown> = {};

          if (fields.title && row[fields.title] !== undefined && row[fields.title] !== null) {
            data.title = String(row[fields.title]);
          }

          if (fields.description && row[fields.description] !== undefined && row[fields.description] !== null) {
            data.description = String(row[fields.description]);
          }

          if (fields.icon && row[fields.icon] !== undefined && row[fields.icon] !== null) {
            data.icon = String(row[fields.icon]);
          }

          if (fields.image && row[fields.image] !== undefined && row[fields.image] !== null) {
            data.image = String(row[fields.image]);
          }

          if (fields.link && row[fields.link] !== undefined && row[fields.link] !== null) {
            data.link = String(row[fields.link]);
          }

          if (fields.featured && row[fields.featured] !== undefined && row[fields.featured] !== null) {
            const value = row[fields.featured];
            data.featured = value === true || value === 1 || value === "1" || value === "true";
          }

          if (fields.tags && row[fields.tags] !== undefined && row[fields.tags] !== null) {
            const tags = normaliseTags(row[fields.tags], tagSeparator);
            if (tags && tags.length > 0) {
              data.tags = tags;
            }
          }

          store.set({
            id: String(idValue),
            data,
          });
        }

        logger.info(`Loaded ${rows.length} entries from TiDB`);
      } catch (error) {
        logger.error(`Unable to execute TiDB query: ${String(error)}`);
      } finally {
        try {
          await connection?.end();
        } catch {
          // ignore connection close errors
        }
      }
    },
  };
}
