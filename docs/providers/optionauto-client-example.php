<?php
class VortexConnector
{
    /*
     ПЕРЕДМОВА: всі дані в коді є тестовими. API ключ зміниться при переході на реальну роботу, так само як і API посилання.
     */
	//const API_KEY = "[redacted]"; //API ключ для тестової роботи
	const API_KEY = "[redacted]"; //API ключ для тестової роботи, клієнт №90
    const API_URL = "https://t2.dev.vortex-services.com/front_api"; //API посилання для тестової роботи
    public function getStocksJson($art_id) {
        $api_module = "Vortex"; //Клас, до якого буде йти звернення на стороні сервера. Це значення змінювати не потрібно.
        $api_method = "get_stocks_for_batch"; //функція, до якої буде йти звернення на стороні сервера. Це значення змінювати не потрібно.

        $method_data =
            [
                "art_ids" => [$art_id], //Ціле число. Внутрішній ідентифікатор запчастини у Vortex. Можна педавати декілька відразу
                "client_id" => 90, // Ідентифікатор клієнта в Вортексі, по якому будуть пораховані продажні ціни 
				"second_level_substitutes" => false
            ];
        return $this->makeAPIRequest($api_module, $api_method, $method_data); // виклик функції, яка робить API запит.
    }

    public function getArticlesByQuery($query) {
        $api_module = "Vortex"; //Клас, до якого буде йти звернення на стороні сервера. Це значення змінювати не потрібно.
        $api_method = "search_articles"; //функція, до якої буде йти звернення на стороні сервера. Це значення змінювати не потрібно.
        $method_data =
            [
			    "client_id" => 90, // Ідентифікатор клієнта в Вортексі
                "query" => $query,  // Запит, по якому відбувається пошук.
									// Тут повинен бути введений номер запчастини ("OC90" наприклад, але можна і не повністю).
									// Якщо "search_by_description" = true то замість артикула треба передавати опис (або частину опису)
                "search_by_description" => false, // увімкнути пошук по опису. Якщо false - пошук буде проводитись за артикулом.
            ];
        return $this->makeAPIRequest($api_module, $api_method, $method_data); // виклик функції, яка робить API запит.
    }

    


    public function makeAPIRequest($api_module, $api_method, $method_data) {
        $time = time(); // поточний timestamp.
        $timeout = 10; // час очікування виконання запиту
        $rand = rand(10000, 99999); // згенероване випадкове число між 10000 та 99999



        $ch = curl_init(); // ініціалізація бібліотеки, яка дозволяє робити звернення на віддалені сервери
        curl_setopt($ch, CURLOPT_URL, self::API_URL); // задання посилання на віддалений сервер
        curl_setopt($ch, CURLOPT_POST, 1); // задання типу запиту як POST
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3); // задання часу очікування підключення
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout); // задання часу очікування виконання запиту
        $request_data = [];
        $request_data['module'] = $api_module; // задання Класу
        $request_data['method'] = $api_method; // задання функції
        $request_data['client_id'] = 90; // Ідентифікатор клієнта в БД Vortex, до якого йде звернення. АПІ ключ повинен бути виділений менеджером конкретно під цього клієнта. 

        $request_data['rand'] = 37507;
		$request_data['time'] = time();
		$request_data['call_type'] = 'crm';
		
        $request_data['data'] = $method_data; // масив з даними, які необхідні для виконання запиту. Формування цього масиву - рядок коду №18
        $request_data['cookies'] = []; // кукіз. Можна передати порожній масив.

        $request_data['hash'] = $this->hashRequest($request_data, self::API_KEY); // хеш запиту. Формується у функції hashRequest

        $request_data = json_encode($request_data); // повний запит перетворюється в json.
        curl_setopt($ch, CURLOPT_POSTFIELDS, $request_data); // задання даних заапиту
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); // вказівка для бібліотеки, щоб відповідь сервера була поміщена в строку.
        $server_output = curl_exec($ch); // виконання запиту бібліотекою curl.
		//var_dump($server_output);
        try
        {
            return json_decode($server_output, true); //спроба повернення результату виконання запиту сервером
        } catch
        (\Exception $e) {
            die($e->getMessage()); // припинення роботи скрипта з повідомленням помилки.
        }
    }

    private function hashRequest($request, $api_key)
    {
        ksort($request['data']); // масив "data" сортується в алфавітному порядку по ключам.
        $joined_data = []; // ініціалізація порожнього масиву

        foreach ($request['data'] as $parameter => $value) { // цикл по даним
            if (gettype($value) === 'array') $value = json_encode($value);
            // "лишня" перевірка чи значення масив. Якщо так - він закодовується в json.
            // Оскільки на рядку №21 і так відбувається перетворення масиву (наявностей) в json, ця перевірка не обов’язкова
            $joined_data[] = $parameter . '=' . $value; // в масив додається строка "ключ=значення"
        }
	
        $joined_data_string = $request['rand'] . '+'
            . $request['time'] . '+'
            . $api_key . '+'
            . $request['method'] . '+'
            . json_encode($request['cookies']) .
            '+data:' . implode('&', $joined_data);
			//echo $joined_data_string;
			//echo "<br>";
			//echo sha1($joined_data_string);
			//die();
        //ПОРЯДОК ПАРАМЕТРІВ ДУЖЕ ВАЖЛИВИЙ. тут формується рядок
        // в якій всі значення запиту (рандомне число, часова мітка, апі ключ, тд.) об’єднуються через "+"
        // і в кінці додається "+data:" і з’єднані через "&" всі елементи масиву, який заповнявся вище.
		
        return sha1($joined_data_string); // для утворення хешу використовується хеш-функція sha1.
    }
}

// ПОЧАТОК ВИКОНАННЯ СКРИПТА 

$api_connector = new VortexConnector(); // Робимо екземпляр класу VortexConnector

$res = $api_connector->getArticlesByQuery("01389"); // Шукаємо запчастини по артикулу «01389»
echo json_encode($res);
$art_id = $res['items'][0]['id']; // Чисто для демонстрації беремо перший артикул зі списку, хоча зрозуміло що в інтерфейсі користувачу потрібно давати вибрати запчастину, що його цікавить

$res = $api_connector->getStocksJson($art_id); // Виймаємо наявності по внутрішньому ідентифікатору запчастини Vortex
echo json_encode($res);


//}
