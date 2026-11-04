CREATE VIEW v_{{name}} AS SELECT v.*,
    json_extract(i.ext, '$.example') AS example
  FROM temp.v_items v JOIN main.items i ON i.pk = v.rid WHERE i.kind = '{{name}}';
