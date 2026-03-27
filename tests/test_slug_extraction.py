#!/usr/bin/env python3
"""测试电影slug提取逻辑"""

import re

# 模拟Gemini的输出
test_response = """您好！根据您想看和《暖暖内含光》风格相似的电影的心情，为您推荐以下两部：

《她》Her (2013, 美国, 126分钟, ⭐ 3.97)
slug: her
推荐理由：《她》和《暖暖内含光》一样，深入探讨了非传统的、深刻的情感关系，涉及爱、连接和孤独的主题，设定在近未来。两部电影都引发了对人类亲密关系的本质以及记忆和存在的复杂性的思考。

《请以你的名字呼唤我》Call Me by Your Name (2017, 意大利/法国/美国/巴西, 132分钟, ⭐ 3.85)
slug: call-me-by-your-name
推荐理由：虽然不是科幻片，但《请以你的名字呼唤我》与《暖暖内含光》有着相似的忧郁而深刻的情感内核。它美丽地描绘了初恋的强烈和苦乐参半的性质以及记忆的持久影响，邀请观众进入对人类联系和渴望的深刻反思体验。
"""

print("=" * 60)
print("测试电影 slug 提取逻辑")
print("=" * 60)

# 方案1: 匹配《标题》...slug: xxx 这样的完整模式
recommended_films = []
film_pattern = r'《([^》]+)》[^《]*?slug:\s*([a-z0-9-]+)'
film_matches = re.finditer(film_pattern, test_response, re.IGNORECASE | re.DOTALL)

for match in film_matches:
    title = match.group(1)
    slug = match.group(2)
    recommended_films.append({'title': title, 'slug': slug})

print("\n方案1 - 精确匹配结果:")
for i, film in enumerate(recommended_films, 1):
    print(f"{i}) {film['title']} (slug: {film['slug']})")

# 方案2: 如果方案1没匹配到，尝试分别提取
if not recommended_films:
    print("\n方案1未匹配到，尝试方案2...")
    recommend_start = max(
        test_response.find('推荐'),
        test_response.find('建议'),
        test_response.find('为您'),
        0
    )
    recommend_text = test_response[recommend_start:] if recommend_start > 0 else test_response
    
    slug_matches = list(re.finditer(r'slug:\s*([a-z0-9-]+)', recommend_text, re.IGNORECASE))
    title_matches = list(re.finditer(r'《([^》]+)》', recommend_text))
    
    num_slugs = len(slug_matches)
    titles = [m.group(1) for m in title_matches[-num_slugs:]] if title_matches else []
    slugs = [m.group(1) for m in slug_matches]
    
    print(f"\n找到 {len(titles)} 个标题, {len(slugs)} 个 slug")
    print(f"标题: {titles}")
    print(f"Slugs: {slugs}")
    
    for i, slug in enumerate(slugs):
        title = titles[i] if i < len(titles) else f"电影 {i+1}"
        recommended_films.append({'title': title, 'slug': slug})
    
    print("\n方案2 - 提取结果:")
    for i, film in enumerate(recommended_films, 1):
        print(f"{i}) {film['title']} (slug: {film['slug']})")

print("\n" + "=" * 60)
print("预期结果:")
print("1) 她 (slug: her)")
print("2) 请以你的名字呼唤我 (slug: call-me-by-your-name)")
print("=" * 60)

# 验证结果
expected = [
    {'title': '她', 'slug': 'her'},
    {'title': '请以你的名字呼唤我', 'slug': 'call-me-by-your-name'}
]

if recommended_films == expected:
    print("\n✅ 测试通过！提取结果正确")
else:
    print("\n❌ 测试失败！提取结果不符合预期")
    print(f"实际: {recommended_films}")
    print(f"预期: {expected}")
