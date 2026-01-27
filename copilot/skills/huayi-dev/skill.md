# huayi-dev Copilot Skill

name: huayi-dev
description: 花易项目数据库开发助手 - Copilot CLI skill
commands:
  - name: huayi-db
    description: Database helper commands for huayi
    usage: |
      huayi-db --config db-config.yaml --list-databases
    script: scripts/huayi_db.py
    args:
      - --config
      - --list-databases
