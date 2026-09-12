// 自动生成，勿手改：python3 tools/build-data-bundle.py
window.GameData = {
  "cards": [
    {
      "id": "neutral_infantry",
      "name": "步兵",
      "faction": "neutral",
      "type": "troop",
      "troopKind": "infantry",
      "cost": 1,
      "attack": 2,
      "health": 1,
      "keywords": [
        "jie_zhen"
      ],
      "skills": [],
      "bonds": [],
      "value": {
        "stats": 3,
        "keywords": -0.5,
        "total": 2.5,
        "budget": 3
      },
      "memo": "相邻有友方步兵时，本次攻击 +1（2→3）",
      "flavor": "结阵而战，进退有度。"
    },
    {
      "id": "neutral_shieldman",
      "name": "盾兵",
      "faction": "neutral",
      "type": "troop",
      "troopKind": "shield",
      "cost": 1,
      "attack": 1,
      "health": 2,
      "keywords": [
        "jia_dun"
      ],
      "skills": [],
      "bonds": [],
      "value": {
        "stats": 3,
        "keywords": -1,
        "total": 4.0,
        "budget": 3
      },
      "memo": "仅前军生效：敌方必须先打掉它才能攻击其他人",
      "flavor": "盾如铁壁，寸步不让。",
      "tuning": {
        "issue": "over_budget",
        "options": [
          {
            "cost": 1,
            "attack": 1,
            "health": 1
          },
          {
            "cost": 2,
            "attack": 1,
            "health": 3
          }
        ]
      }
    },
    {
      "id": "neutral_archer",
      "name": "弓箭手",
      "faction": "neutral",
      "type": "troop",
      "troopKind": "archer",
      "cost": 1,
      "attack": 1,
      "health": 1,
      "keywords": [
        "shen_she"
      ],
      "skills": [],
      "bonds": [],
      "value": {
        "stats": 2,
        "keywords": -0.5,
        "total": 2.5,
        "budget": 3
      },
      "memo": "可攻击任意列的人物卡，无视距离",
      "flavor": "百步穿杨，取敌于阵后。",
      "tuning": {
        "issue": "under_budget",
        "options": [
          {
            "cost": 1,
            "attack": 1,
            "health": 2
          },
          {
            "cost": 2,
            "attack": 2,
            "health": 2
          }
        ]
      }
    },
    {
      "id": "neutral_chuanguo_yuxi",
      "name": "传国玉玺",
      "faction": "neutral",
      "type": "special",
      "cost": 0,
      "keywords": [],
      "skills": [],
      "bonds": [],
      "effects": [
        {
          "action": "gain_command",
          "value": 1,
          "duration": "this_turn"
        }
      ],
      "memo": "0 费，本回合统率 +1（仅后手获得）",
      "flavor": "受命于天，既寿永昌。"
    }
  ],
  "heroes": [
    {
      "id": "shu_liubei",
      "name": "刘备",
      "faction": "shu",
      "type": "special",
      "cost": 0,
      "skill": "仁德",
      "memo": "主公技：为一名友方人物恢复 2 点生命",
      "flavor": "惟贤惟德，能服于人。"
    },
    {
      "id": "wei_caocao",
      "name": "曹操",
      "faction": "wei",
      "type": "special",
      "cost": 0,
      "skill": "号令",
      "memo": "主公技：使一名友方人物本回合 +2 攻击",
      "flavor": "宁教我负天下人，休教天下人负我。"
    },
    {
      "id": "wu_sunquan",
      "name": "孙权",
      "faction": "wu",
      "type": "special",
      "cost": 0,
      "skill": "坐断东南",
      "memo": "主公技：获得 2 点护甲",
      "flavor": "生子当如孙仲谋。"
    },
    {
      "id": "qun_dongzhuo",
      "name": "董卓",
      "faction": "qun",
      "type": "special",
      "cost": 0,
      "skill": "暴虐",
      "memo": "主公技：抽 1 张牌，并对自己的主将造成 1 点伤害",
      "flavor": "顺我者昌，逆我者亡。"
    }
  ]
};
