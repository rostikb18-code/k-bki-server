import logging
import asyncio
import sqlite3
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# Настройка логирования
logging.basicConfig(level=logging.INFO)

BOT_TOKEN = 8951982282:AAGzsmjmEI2tq5MV63EIsE9W0Kap-ipL_2E
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Инициализация тестовой базы данных в оперативной памяти (для примера)
# В реальном проекте замените на файл 'users_base.db'
conn = sqlite3.connect(':memory:', check_same_thread=False)
cursor = conn.cursor()

# Создаем учебную таблицу, имитирующую внутреннюю базу сотрудников/клиентов
cursor.execute('''
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    last_name TEXT,
    first_name TEXT,
    patronymic TEXT,
    birth_day INTEGER,
    birth_month INTEGER,
    birth_year INTEGER,
    age INTEGER,
    birth_place TEXT,
    country TEXT,
    phone TEXT
)
''')
# Наполняем тестовыми легальными данными для демонстрации работы поиска
sample_data = [
    ('Иванов', 'Иван', 'Иванович', 15, 5, 1990, 36, 'Москва', 'Россия', '+79991112233'),
    ('Иванова', 'Мария', 'Петровна', 20, 8, 1995, 31, 'Санкт-Петербург', 'Россия', '+79994445566'),
    ('Петров', 'Алексей', 'Сергеевич', 5, 12, 1988, 38, 'Минск', 'Беларусь', '+375291111111')
]
cursor.executemany('''
INSERT INTO people (last_name, first_name, patronymic, birth_day, birth_month, birth_year, age, birth_place, country, phone)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', sample_data)
conn.commit()


# Состояния для пошагового сбора критериев поиска
class SearchStates(StatesGroup):
    waiting_for_last_name = State()
    waiting_for_first_name = State()
    waiting_for_patronymic = State()
    waiting_for_birth_date = State()  # день, месяц, год
    waiting_for_age = State()
    waiting_for_birth_place = State()
    waiting_for_country = State()

# Кнопки навигации
kb_skip = ReplyKeyboardMarkup(
    keyboard=[[KeyboardButton(text="Пропустить шаг")]],
    resize_keyboard=True
)
kb_search = ReplyKeyboardMarkup(
    keyboard=[[KeyboardButton(text="🔍 Начать поиск")]],
    resize_keyboard=True
)

@dp.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Добро пожаловать в систему поиска по внутренней базе.\n"
        "Давайте заполним известные параметры. Если параметр неизвестен — нажмите 'Пропустить шаг'.",
        reply_markup=kb_skip
    )
    await message.answer("Введите Фамилию (или её часть):", reply_markup=kb_skip)
    await state.set_state(SearchStates.waiting_for_last_name)

@dp.message(SearchStates.waiting_for_last_name)
async def process_last_name(message: Message, state: FSMContext):
    val = message.text.strip()
    await state.update_data(last_name=None if val == "Пропустить шаг" else val)
    await message.answer("Введите Имя:")
    await state.set_state(SearchStates.waiting_for_first_name)

@dp.message(SearchStates.waiting_for_first_name)
async def process_first_name(message: Message, state: FSMContext):
    val = message.text.strip()
    await state.update_data(first_name=None if val == "Пропустить шаг" else val)
    await message.answer("Введите Отчество:")
    await state.set_state(SearchStates.waiting_for_patronymic)

@dp.message(SearchStates.waiting_for_patronymic)
async def process_patronymic(message: Message, state: FSMContext):
    val = message.text.strip()
    await state.update_data(patronymic=None if val == "Пропустить шаг" else val)
    await message.answer("Введите дату рождения в формате ДД.ММ.ГГГГ (или пропустите):")
    await state.set_state(SearchStates.waiting_for_birth_date)

@dp.message(SearchStates.waiting_for_birth_date)
async def process_birth_date(message: Message, state: FSMContext):
    val = message.text.strip()
    if val == "Пропустить шаг":
        await state.update_data(day=None, month=None, year=None)
    else:
        try:
            parts = val.split('.')
            await state.update_data(day=int(parts[0]), month=int(parts[1]), year=int(parts[2]))
        except ValueError:
            await message.answer("Неверный формат. Запись пропущена.")
            await state.update_data(day=None, month=None, year=None)
            
    await message.answer("Введите точный возраст (цифрой):")
    await state.set_state(SearchStates.waiting_for_age)

@dp.message(SearchStates.waiting_for_age)
async def process_age(message: Message, state: FSMContext):
    val = message.text.strip()
    try:
        await state.update_data(age=None if val == "Пропустить шаг" else int(val))
    except ValueError:
        await state.update_data(age=None)
    await message.answer("Введите место рождения (город):")
    await state.set_state(SearchStates.waiting_for_birth_place)

@dp.message(SearchStates.waiting_for_birth_place)
async def process_birth_place(message: Message, state: FSMContext):
    val = message.text.strip()
    await state.update_data(birth_place=None if val == "Пропустить шаг" else val)
    await message.answer("Введите страну:", reply_markup=kb_search)
    await state.set_state(SearchStates.waiting_for_country)

@dp.message(SearchStates.waiting_for_country)
@dp.message(F.text == "🔍 Начать поиск")
async def process_country_and_search(message: Message, state: FSMContext):
    current_state = await state.get_state()
    
    # Если пользователь нажал кнопку поиска до ввода страны
    if current_state == SearchStates.waiting_for_country:
        val = message.text.strip()
        if val != "🔍 Начать поиск":
            await state.update_data(country=None if val == "Пропустить шаг" else val)
        else:
            await state.update_data(country=None)

    data = await state.get_data()
    await state.clear()
    
    # Формирование динамического SQL-запроса
    query = "SELECT * FROM people WHERE 1=1"
    params = []
    
    # Текстовые поля проверяются через LIKE для поиска по части слова
    if data.get('last_name'):
        query += " AND last_name LIKE ?"
        params.append(f"%{data['last_name']}%")
    if data.get('first_name'):
        query += " AND first_name LIKE ?"
        params.append(f"%{data['first_name']}%")
    if data.get('patronymic'):
        query += " AND patronymic LIKE ?"
        params.append(f"%{data['patronymic']}%")
    if data.get('birth_place'):
        query += " AND birth_place LIKE ?"
        params.append(f"%{data['birth_place']}%")
    if data.get('country'):
        query += " AND country LIKE ?"
        params.append(f"%{data['country']}%")
        
    # Числовые поля проверяются на точное совпадение
    if data.get('day'):
        query += " AND birth_day = ?"
        params.append(data['day'])
    if data.get('month'):
        query += " AND birth_month = ?"
        params.append(data['month'])
    if data.get('year'):
        query += " AND birth_year = ?"
        params.append(data['year'])
    if data.get('age'):
        query += " AND age = ?"
        params.append(data['age'])

    # Выполнение запроса
    cursor.execute(query, params)
    results = cursor.fetchall()
    
    if not results:
        await message.answer("Пользователи с такими параметрами во внутренней базе не найдены.", reply_markup=ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text="/start")]], resize_keyboard=True))
        return
        
    response = "🔍 **Результаты поиска по локальной базе:**\n\n"
    for row in results:
        response += (
            f"👤 ФИО: {row[1]} {row[2]} {row[3]}\n"
            f"📅 Дата рождения: {row[4]}.{row[5]}.{row[6]} ({row[7]} лет)\n"
            f"📍 Место: {row[8]}, {row[9]}\n"
            f"📞 Телефон: {row[10]}\n"
            f"⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n"
        )
        
    await message.answer(response, parse_mode="Markdown")

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
