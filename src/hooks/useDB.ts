import { toast } from 'sonner';
import useSWR from 'swr';
import { getDataBaseInstance } from '../single/db';
import { GET_PROXY_SERVERS_SWR_KEY, GET_SUBSCRIPTIONS_LIST_SWR_KEY, ProxyServer, Subscription } from '../types/definition';





const subscriptionsFetcher = async () => {
    try {
        const db = await getDataBaseInstance();
        return await db.select('SELECT * FROM subscriptions') as Subscription[]
    } catch (error) {
        console.error('Error fetching subscriptions:', error)
        toast.error(`订阅失败 ${error}`)
        return []

    }
}

export function useSubscriptions() {
    return useSWR<Subscription[]>(GET_SUBSCRIPTIONS_LIST_SWR_KEY, subscriptionsFetcher)
}

const proxyServersFetcher = async () => {
    try {
        const db = await getDataBaseInstance();
        return await db.select('SELECT * FROM proxy_servers ORDER BY is_active DESC, name ASC') as ProxyServer[]
    } catch (error) {
        console.error('Error fetching proxy servers:', error)
        return []
    }
}

export function useProxyServers() {
    return useSWR<ProxyServer[]>(GET_PROXY_SERVERS_SWR_KEY, proxyServersFetcher)
}


