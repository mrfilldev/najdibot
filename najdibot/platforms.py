from urllib.parse import quote_plus

PLATFORMS = [
    ("Ozon", "https://www.ozon.ru/search/?text={q}"),
    ("Wildberries", "https://www.wildberries.ru/catalog/0/search.aspx?search={q}"),
    ("Яндекс Маркет", "https://market.yandex.ru/search?text={q}"),
    ("DNS", "https://www.dns-shop.ru/search/?q={q}"),
    ("Авито", "https://www.avito.ru/rossiya?q={q}"),
]


def search_links(query: str) -> list[tuple[str, str]]:
    q = quote_plus(query.strip())
    return [(name, tpl.format(q=q)) for name, tpl in PLATFORMS]
