# -*- coding: utf-8 -*-
"""由 cards_photo.draft.yaml（+ 口述录入区）生成 cards_v1.draft.yaml 初步定稿。"""
import yaml, datetime
from pathlib import Path
ROOT = Path('/Users/xuxu/workspace/game_test')

# 照片编号 -> id  （按 AGENTS.md 命名约定：阵营前缀_拼音）
IDS = {
 46:'neutral_infantry_DUP',160:'neutral_infantry',142:'neutral_archer',143:'neutral_archer_DUP',
 108:'token_jixie_shaobing',109:'token_jixie_shouwei',52:'status_jia_dun',
 47:'event_shichangshi',48:'event_huangjin',49:'event_fengnian',53:'event_zainian',
 155:'event_huoshaoluoyang',156:'event_nanmanruqin',
 50:'tactic_bishi_ruiqi',51:'tactic_cuoqi_ruiqi',140:'tactic_gongxinji',141:'tactic_zhuchengjiliang',
 144:'tactic_anduchencang',145:'tactic_kongchengji',146:'tactic_shizhanqunru',147:'tactic_xiushengyangxi',
 148:'tactic_yuqin_guzong',149:'tactic_chuqibuyi',150:'tactic_chenhuodajie',151:'tactic_tuntian',
 152:'tactic_huogong',153:'tactic_fudichouxin',154:'tactic_caochuanjiejian',157:'tactic_mantianguohai',
 158:'tactic_jijiang',159:'tactic_bishijixu',
 54:'qun_gaoshun',55:'qun_mateng',56:'qun_gongsunzan',57:'qun_quyi',70:'qun_yuanshao',122:'qun_yuanshao_lord',
 71:'qun_zhangbao',72:'qun_zhangliang',73:'qun_caimao',74:'qun_songxian',75:'qun_huangzu',
 76:'qun_diaochan',77:'qun_caiwenji',78:'qun_tianfeng',79:'qun_huatuo',80:'qun_chengong',
 81:'qun_zuoci',121:'qun_huaxiong',119:'qun_draft_zhangfei',
 58:'shu_chendao',82:'shu_madai',83:'shu_dongjue',84:'shu_xiangchong',85:'shu_huangquan',
 86:'shu_liufeng',87:'shu_guanxing',88:'shu_zhangbao',89:'shu_jiangwei',90:'shu_machao',
 91:'shu_guanping',93:'shu_zhangfei',94:'shu_weiyan',95:'shu_zhaoyun',96:'shu_huangzhong',
 97:'shu_shamoke',98:'shu_guanyu',99:'shu_huanghao',100:'shu_fazheng',101:'shu_mifang',
 102:'shu_masu',103:'shu_jianyang',104:'shu_pangtong',105:'shu_zhugeliang',106:'shu_zhoucang',
 107:'shu_huangyueying',
 59:'wei_xiahouyuan',60:'wei_zhangliao',61:'wei_chengyu',62:'wei_xunyou',63:'wei_xuhuang',
 64:'wei_xiahoudun',65:'wei_zhanghe',66:'wei_jiaxu',67:'wei_guojia',68:'wei_xuchu',69:'wei_simayi',
 110:'wei_caocao_lord',111:'wei_zhangyan',112:'wei_caoxiu',113:'wei_caogang',114:'wei_xiahouen',
 115:'wei_guohuai',116:'wei_caozhang',117:'wei_caoren',118:'wei_dianwei',120:'wei_xunyu',
 124:'wu_zhouyu',125:'wu_luxun',126:'wu_taishici',127:'wu_sunce',128:'wu_chengpu',129:'wu_lvmeng',
 130:'wu_lingtong',131:'wu_ganning',132:'wu_sunjian',133:'wu_huanggai',134:'wu_handang',
 135:'wu_lukang',136:'wu_zhoutai',137:'wu_zhuhuan',138:'wu_dingfeng',139:'wu_zhugeke',
}
FAC = {'蜀':'shu','魏':'wei','吴':'wu','群':'qun'}
TYPE = {'武将':'general','谋臣':'strategist','主公':'lord','计谋卡':'tactic',
        '事件卡':'event','战法卡':'tactic','兵种':'troop','临时卡':'token','属性卡':'status'}

TYPE_FIX = {'qun_yuanshao_lord': 'lord', 'shu_huangquan': 'general'}

dec = yaml.safe_load(open(ROOT/'data/cards_decisions.draft.yaml', encoding='utf-8'))
PHOTO_TAGS: dict[int, list[str]] = {}
for tag, photos in (dec.get('card_tags') or {}).items():
    for ph in photos:
        PHOTO_TAGS.setdefault(ph, []).append(tag)

d = yaml.safe_load(open(ROOT/'data/cards_photo.draft.yaml', encoding='utf-8'))
out, skipped = [], []
for r in sorted(d['cards'], key=lambda r: int(r['photo'])):
    ph = int(r['photo'])
    if r.get('excluded') or r.get('type_proposed') == '非卡牌（设计者确认忽略）':
        skipped.append((ph, r.get('name') or r.get('card_type'),
                        r.get('exclude_reason') or '移出卡池/非卡牌')); continue
    if ph in (46,143):   # 与 160/142 完全相同的重抄件
        skipped.append((ph, r.get('name') or r.get('card_type'), '重抄件，与 #160/#142 重复')); continue
    if r.get('excluded'):  # 设计者移出卡池
        skipped.append((ph, r.get('name') or r.get('card_type'), r.get('exclude_reason') or '设计者移出卡池')); continue
    cid = IDS.get(ph)
    if not cid:
        skipped.append((ph, r.get('name'), '⚠️ 无 id 映射')); continue
    typ = TYPE.get(r.get('type_proposed') or '', '')
    typ = TYPE_FIX.get(cid, typ)          # 规则判不出的个例（如主公卡）
    flags = []
    if r.get('type_conflict'): flags.append(r['type_conflict'])
    if r.get('is_draft'): flags.append('未定稿：' + '；'.join(r.get('draft_marks') or []))
    if r.get('uncertain'): flags.append(f"转录存疑 {len(r['uncertain'])} 处（详见 cards_photo.draft.yaml）")
    if not (r.get('memo')): flags.append('缺 memo')
    card = {'id': cid, 'name': r.get('name') or r.get('card_type'), 'faction': FAC.get(r.get('faction') or '', 'neutral'),
            'type': typ, 'cost': r.get('cost')}
    if typ in ('general','strategist','troop'):
        card['attack'] = r.get('attack'); card['health'] = r.get('health')
    if r.get('skill_name') or r.get('skill_text'):
        card['skills'] = [{'name': r.get('skill_name') or '', 'text': r.get('skill_text') or '',
                           'dsl': None, 'note': '效果 DSL 待翻译（尚未开始）'}]
    card['keywords'] = []
    if PHOTO_TAGS.get(ph):
        card['tags'] = PHOTO_TAGS[ph]
    card['memo'] = r.get('memo') or ''
    card['flavor'] = r.get('flavor') or ''
    card['source'] = {'photo': ph}
    if flags: card['flags'] = flags
    out.append(card)

# 口述录入区（吴国 6 人）
for c in yaml.safe_load(open(ROOT/'data/characters.draft.yaml', encoding='utf-8')):
    out.append({'id': c['id'], 'name': c['name'], 'faction': c['faction'], 'type': c['type'],
                'cost': c['cost'], 'attack': c.get('attack'), 'health': c.get('health'),
                'skills': [], 'keywords': c.get('keywords') or [], 'memo': c.get('memo') or '',
                'flavor': c.get('flavor') or '', 'source': {'oral': True},
                'flags': ['口述录入，数值未经校验']})

# 基础卡：盾兵（设计者答疑给出新数值）、传国玉玺（沿用 cards.yaml）
out.append({'id':'neutral_shieldman','name':'盾兵','faction':'neutral','type':'troop',
    'cost':2,'attack':1,'health':2,'skills':[],'keywords':['jia_dun'],
    'memo':'仅前军生效：敌方必须先打掉它才能攻击其他人','flavor':'盾如铁壁，寸步不让。',
    'source':{'oral':True,'note':'设计者答疑给出新数值（原 cards.yaml 为 1 费 1/2）'}})
out.append({'id':'neutral_chuanguo_yuxi','name':'传国玉玺','faction':'neutral','type':'special',
    'cost':0,'skills':[{'name':'','text':'本回合统率 +1（仅后手获得）','dsl':None,'note':'沿用 cards.yaml'}],
    'keywords':[],'memo':'0 费，本回合统率 +1（仅后手获得）','flavor':'受命于天，既寿永昌。',
    'source':{'from':'cards.yaml'}})

# 设计者新增的卡（非照片来源）
for nc in dec.get('new_cards') or []:
    card = {'id': nc['id'], 'name': nc['name'], 'faction': nc['faction'], 'type': nc['type'],
            'cost': nc['cost']}
    if nc.get('attack') is not None: card['attack'] = nc['attack']
    if nc.get('health') is not None: card['health'] = nc['health']
    if nc.get('skill_text'): card['skills'] = [{'name': nc.get('skill_name',''), 'text': nc['skill_text'],
                                                'dsl': None, 'note': '效果 DSL 待翻译'}]
    card['keywords'] = []
    if nc.get('tags'): card['tags'] = nc['tags']
    card['memo'] = ''; card['flavor'] = ''
    card['source'] = {'new': nc.get('source','设计者新增')}
    if nc.get('open'): card['flags'] = list(nc['open'])
    out.append(card)

# 合并 DSL 翻译（决策层 dsl / dsl_effects）
DSL = dec.get('dsl') or {}
DSL_EFF = dec.get('dsl_effects') or {}
COST_RULES = dec.get('card_cost_rules') or {}
DSL_NONE = set(DSL.get('_none') or [])
for card in out:
    if card['id'] in DSL_NONE:
        card['dsl_status'] = '无技能（白板/关键词卡），无需翻译'
        continue
    if card['id'] in DSL:
        if not card.get('skills'):
            card['skills'] = [{'name': '', 'text': '', 'dsl': None, 'note': ''}]
        card['skills'][0]['dsl'] = DSL[card['id']]
        card['skills'][0]['note'] = 'DSL 已翻译'
    if card['id'] in COST_RULES:
        card['cost_rule'] = COST_RULES[card['id']]
        card['dsl_status'] = '条件费用规则（cost_rule），无独立技能'
    if card['id'] in DSL_EFF:
        card['effects'] = DSL_EFF[card['id']]
        if card.get('skills'):
            card['skills'][0]['note'] = 'DSL 已翻译（卡级 effects）'

doc = {
 'meta': {'version': 'v1', 'status': '初步定稿（待 DSL 翻译与数值校验）',
          'generated': datetime.date.today().isoformat(),
          'note': '本文件由工具生成，数据源为 cards_photo.draft.yaml + characters.draft.yaml。不要手改。',
          'skipped': [{'photo': p, 'name': n, 'why': w} for p, n, w in skipped]},
 'cards': out,
}
open(ROOT/'data/cards_v1.draft.yaml', 'w', encoding='utf-8').write(
    yaml.dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False, width=1000))
# 额外导出 JSON（含已翻译 DSL），供 core/tools/verify-dsl.ts 验证
import json
(ROOT/'core'/'data').mkdir(parents=True, exist_ok=True)
json.dump(out, open(ROOT/'core'/'data'/'cards_v1.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

print(f'✓ cards_v1.draft.yaml：{len(out)} 张卡')
print(f'  跳过 {len(skipped)} 条：')
for p,n,w in skipped: print(f'    #{p} {n} —— {w}')
