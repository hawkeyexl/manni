-- Reader traffic per journey and per persona, from a page-views export.
-- Bind the export with --param views:=<json>, a list of {page, views, exits}.
-- The route is graph.routes in manni.config.yaml: its basePath and its root.
WITH route(base, root) AS (VALUES ('/manni/', 'docs/src/content/docs')),
views AS (
  SELECT url, sum(views) AS views, sum(exits) AS exits
  FROM (SELECT rtrim(replace(substr(value ->> 'page', 1, instr((value ->> 'page') || '?', '?') - 1), '.html', ''), '/') AS url,
               value ->> 'views' AS views, value ->> 'exits' AS exits
        FROM json_each($views))
  GROUP BY url
),
pages AS (
  SELECT _path, journeys, personas,
         rtrim(base || CASE WHEN rest = 'index' THEN ''
                            WHEN rest LIKE '%/index' THEN substr(rest, 1, length(rest) - 6)
                            ELSE rest END, '/') AS url
  FROM (SELECT _path, base,
               CASE WHEN journeys IS NULL OR json_valid(journeys) THEN journeys ELSE json_array(journeys) END AS journeys,
               CASE WHEN personas IS NULL OR json_valid(personas) THEN personas ELSE json_array(personas) END AS personas,
               rtrim(substr(rtrim(_path, replace(_path, '.', '')), length(root) + 2), '.') AS rest
        FROM docs, route WHERE _path LIKE root || '/%')
),
named AS (
  SELECT 'journey' AS kind, lower(j.value) AS id, p.url FROM pages p, json_each(p.journeys) j
  UNION ALL
  SELECT 'persona', lower(x.value), p.url FROM pages p, json_each(p.personas) x
)
SELECT s.type AS kind, s.id AS id, s.title AS title, count(n.url) AS pages, count(v.url) AS measured,
       coalesce(sum(v.views), 0) AS views, round(1.0 * sum(v.exits) / sum(v.views), 2) AS exit_rate
FROM docs s
LEFT JOIN named n ON n.kind = s.type AND n.id = lower(s.id)
LEFT JOIN views v ON v.url = n.url
WHERE s.type IN ('journey', 'persona')
GROUP BY s.type, s.id
UNION ALL
SELECT 'unplanned', p._path, NULL, 1, 1, v.views, round(1.0 * v.exits / v.views, 2)
FROM views v JOIN pages p ON p.url = v.url WHERE p.journeys IS NULL
UNION ALL
SELECT 'unmatched', v.url, NULL, 0, 0, v.views, NULL
FROM views v WHERE v.url IS NULL OR v.url NOT IN (SELECT url FROM pages)
ORDER BY views DESC, kind, id
