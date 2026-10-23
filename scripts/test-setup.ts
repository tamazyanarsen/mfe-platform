import { GlobalRegistrator } from "@happy-dom/global-registrator";

// http-адрес, а не about:blank: роутеру хоста нужна рабочая History API.
GlobalRegistrator.register({ url: "http://localhost:3000/" });
