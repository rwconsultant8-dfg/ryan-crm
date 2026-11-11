import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch, Mock

spec=importlib.util.spec_from_file_location('crm_worker',Path(__file__).with_name('worker.py'))
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
CONFIG={'app_url':'https://crm.example','token':'private-test-worker-token-with-thirty-two-characters'}
class Response(io.BytesIO):
    status=200
    def __init__(self,body):super().__init__(json.dumps(body).encode())
class WorkerDelivery(unittest.TestCase):
    def test_same_result_is_retried_without_exposing_credentials(self):
        opener=Mock();opener.open.side_effect=[urllib.error.URLError('network'),Response({'ok':True})]
        with patch.object(worker.urllib.request,'build_opener',return_value=opener),patch.object(worker.time,'sleep'),patch('builtins.print') as log:
            self.assertEqual(worker.api(CONFIG,{'id':'job','lease':'lease','result':{'safe':'result'}}),{'ok':True})
        requests=[call.args[0] for call in opener.open.call_args_list]
        self.assertEqual(requests[0].data,requests[1].data)
        self.assertNotIn(CONFIG['token'],str(log.call_args_list))
    def test_permanent_auth_error_is_not_retried(self):
        opener=Mock();opener.open.side_effect=urllib.error.HTTPError('https://crm.example',401,'Denied',{},None)
        with patch.object(worker.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(urllib.error.HTTPError):worker.api(CONFIG)
        self.assertEqual(opener.open.call_count,1)
    def test_consumed_lease_is_not_replayed(self):
        opener=Mock();opener.open.side_effect=urllib.error.HTTPError('https://crm.example',409,'Claim consumed',{},None)
        with patch.object(worker.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(worker.ClaimUnavailable):worker.api(CONFIG,{'id':'job'})
        self.assertEqual(opener.open.call_count,1)
    def test_retries_are_bounded(self):
        opener=Mock();opener.open.side_effect=urllib.error.HTTPError('https://crm.example',503,'Unavailable',{},None)
        with patch.object(worker.urllib.request,'build_opener',return_value=opener),patch.object(worker.time,'sleep'):
            with self.assertRaises(urllib.error.HTTPError):worker.api(CONFIG)
        self.assertEqual(opener.open.call_count,3)
    def test_rejected_output_reports_failed_instead_of_stranding_lease(self):
        job={'id':'job','lease':'lease'}
        error=urllib.error.HTTPError('https://crm.example',400,'Invalid result',{},None)
        with patch.object(worker,'api',side_effect=[job,error,{'ok':True}]) as api,patch.object(worker,'extract',return_value={'response':{'kind':'chat','text':'answer'}}):
            self.assertTrue(worker.run_once(CONFIG))
        self.assertEqual(api.call_args_list[-1].args[1],{'id':'job','lease':'lease','failed':True})
if __name__=='__main__':unittest.main()
