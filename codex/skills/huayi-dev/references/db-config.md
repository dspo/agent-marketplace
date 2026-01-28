# Database Config Format

The YAML file passed to `--database-config` must contain a root `databases` mapping.
Each entry defines a connection profile.

Required fields per instance:
- `driver` (only `mysql` is supported)
- `host`
- `port` (default: 3306)
- `username`
- `password`

Optional fields:
- `description`
- `database` (default schema to connect to)

Environment variables can be referenced as `${VAR_NAME}` in any string value.
Missing variables will raise an error.

Example:

```yaml
databases:
  haoxiangmei:
    description: Haoxiangmei DB for real-time stock
    driver: mysql
    host: "example.mysql.rds.aliyuncs.com"
    port: 3306
    username: huajisuperuser
    password: ${HUAYI_DB_HAIXIANGMEI_PASSWORD}
    database: huayi_haoxiangmei
  fusion:
    description: Huaji fusion DB
    driver: mysql
    host: "example.mysql.rds.aliyuncs.com"
    port: 3306
    username: huajisuperuser
    password: ${HUAYI_DB_FUSION_PASSWORD}
    database: huayi_dual_fusion
```
