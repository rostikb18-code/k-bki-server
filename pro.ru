import requests

def search_by_fio(fio, api_key, secret_key):
    url = "https://dadata.ru"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Token {api_key}",
        "X-Secret": f_secret_key
    }
    
    # Запрос к открытой базе организаций и ИП
    data = [fio]
    
    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 200:
            result = response.json()
            for item in result:
                print(f"Найдено совпадение: {item.get('source')}")
                # Если в реестре указаны публичные контакты:
                phones = item.get('phones')
                if phones:
                    print(f"Публичные телефоны: {phones}")
                else:
                    print("Открытые телефоны в реестре не найдены.")
        else:
            print(f"Ошибка запроса: {response.status_code}")
    except Exception as e:
        print(f"Произошла ошибка: {e}")

# Перед запуском укажите свои ключи с сайта dadata.ru
API_KEY = "ВАШ_API_KEY"
SECRET_KEY = "ВАШ_SECRET_KEY"

fio_input = input("Введите ФИО для поиска в реестрах: ")
search_by_fio(fio_input, API_KEY, SECRET_KEY)
